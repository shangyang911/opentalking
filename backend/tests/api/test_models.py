from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from apps.api.modules.system import models as models_routes
from opentalking.core.config import Settings
from opentalking.core.model_config import clear_model_config_cache
from opentalking.providers.synthesis.availability import (
    _fetch_omnirt_audio2video_models,
    resolve_model_statuses,
)
from opentalking.providers.synthesis.omnirt import resolve_synthesis_ws_url


@pytest.fixture(autouse=True)
def isolate_model_config(monkeypatch):
    monkeypatch.delenv("OPENTALKING_CONFIG_FILE", raising=False)
    monkeypatch.delenv("CONFIG_FILE", raising=False)
    monkeypatch.delenv("OPENTALKING_QUICKTALK_BACKEND", raising=False)
    clear_model_config_cache()
    yield
    clear_model_config_cache()


def _write_quicktalk_local_assets(asset_root) -> None:
    checkpoints = asset_root / "checkpoints"
    (checkpoints / "chinese-hubert-large").mkdir(parents=True)
    (checkpoints / "auxiliary" / "models" / "buffalo_l").mkdir(parents=True)
    (checkpoints / "quicktalk.pth").write_bytes(b"pth")
    (checkpoints / "repair.npy").write_bytes(b"repair")
    (checkpoints / "chinese-hubert-large" / "pytorch_model.bin").write_bytes(b"hubert")
    (checkpoints / "auxiliary" / "models" / "buffalo_l" / "det_10g.onnx").write_bytes(b"onnx")


def test_models_route_lists_supported_models_with_connection_status(monkeypatch) -> None:
    monkeypatch.setenv("OPENTALKING_QUICKTALK_BACKEND", "local")
    monkeypatch.setattr(
        "opentalking.models.quicktalk.adapter.QuickTalkAdapter.runtime_available",
        staticmethod(lambda settings=None: False),
    )
    app = FastAPI()
    app.state.settings = SimpleNamespace(omnirt_endpoint="")
    app.include_router(models_routes.router)

    with TestClient(app) as client:
        response = client.get("/models")

    assert response.status_code == 200
    payload = response.json()
    assert payload["models"] == ["mock", "quicktalk"]
    statuses = {item["id"]: item for item in payload["statuses"]}
    assert set(statuses) == {"mock", "quicktalk"}
    assert statuses["mock"]["backend"] == "mock"
    assert statuses["mock"]["connected"] is True
    assert statuses["mock"]["reason"] == "local_self_test"
    assert statuses["quicktalk"]["backend"] == "local"
    assert statuses["quicktalk"]["connected"] is False
    assert statuses["quicktalk"]["reason"] == "local_adapter_missing"


@pytest.mark.parametrize("default_model", ["mock", "quicktalk"])
def test_models_route_exposes_valid_default_model_from_settings(monkeypatch, default_model) -> None:
    monkeypatch.setattr(
        "opentalking.models.quicktalk.adapter.QuickTalkAdapter.runtime_available",
        staticmethod(lambda settings=None: False),
    )
    app = FastAPI()
    app.state.settings = SimpleNamespace(default_model=default_model, omnirt_endpoint="")
    app.include_router(models_routes.router)

    with TestClient(app) as client:
        response = client.get("/models")

    assert response.status_code == 200
    assert response.json()["default_model"] == default_model


def test_settings_loads_default_model_from_environment(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("OPENTALKING_DEFAULT_MODEL", "mock")
    monkeypatch.chdir(tmp_path)

    settings = Settings(_env_file=None)

    assert settings.default_model == "mock"


def test_settings_loads_quicktalk_local_fields_from_environment(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("OPENTALKING_QUICKTALK_ASSET_ROOT", str(tmp_path / "models" / "quicktalk"))
    monkeypatch.setenv("OPENTALKING_QUICKTALK_BACKEND", "local")
    monkeypatch.setenv("OPENTALKING_QUICKTALK_MODEL_BACKEND", "auto")
    monkeypatch.setenv("OPENTALKING_QUICKTALK_DEVICE", "mps")
    monkeypatch.setenv("OPENTALKING_QUICKTALK_SLICE_LEN", "12")
    monkeypatch.chdir(tmp_path)

    settings = Settings(_env_file=None)

    assert settings.quicktalk_asset_root == str(tmp_path / "models" / "quicktalk")
    assert settings.quicktalk_backend == "local"
    assert settings.quicktalk_model_backend == "auto"
    assert settings.quicktalk_device == "mps"
    assert settings.quicktalk_slice_len == 12


def test_settings_loads_default_model_from_yaml_model_section(monkeypatch, tmp_path) -> None:
    config_file = tmp_path / "opentalking.yaml"
    config_file.write_text("model:\n  default_model: mock\n", encoding="utf-8")
    monkeypatch.setenv("OPENTALKING_CONFIG_FILE", str(config_file))
    monkeypatch.delenv("OPENTALKING_DEFAULT_MODEL", raising=False)
    monkeypatch.chdir(tmp_path)

    settings = Settings(_env_file=None)

    assert settings.default_model == "mock"


def test_omnirt_endpoint_defaults_to_quicktalk_audio2video_route() -> None:
    settings = SimpleNamespace(omnirt_endpoint="http://127.0.0.1:9000")

    assert resolve_synthesis_ws_url("quicktalk", settings) == (
        "ws://127.0.0.1:9000/v1/audio2video/quicktalk"
    )


async def test_omnirt_status_keeps_local_quicktalk_backend_local(monkeypatch) -> None:
    monkeypatch.setenv("OPENTALKING_QUICKTALK_BACKEND", "local")
    monkeypatch.setattr(
        "opentalking.models.quicktalk.adapter.QuickTalkAdapter.runtime_available",
        staticmethod(lambda settings=None: True),
    )

    async def fake_fetch(_settings) -> set[str]:
        return {"quicktalk"}

    monkeypatch.setattr(
        "opentalking.providers.synthesis.availability._fetch_omnirt_audio2video_models",
        fake_fetch,
    )
    settings = SimpleNamespace(omnirt_endpoint="http://127.0.0.1:9000")

    statuses = {status.id: status for status in await resolve_model_statuses(settings)}

    assert statuses["quicktalk"].backend == "local"
    assert statuses["quicktalk"].connected is True
    assert statuses["quicktalk"].reason == "local_runtime"


async def test_models_status_uses_settings_for_local_quicktalk_assets(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENTALKING_QUICKTALK_ASSET_ROOT", raising=False)
    monkeypatch.delenv("OPENTALKING_QUICKTALK_MODEL_ROOT", raising=False)
    monkeypatch.setenv("OPENTALKING_QUICKTALK_BACKEND", "local")
    asset_root = tmp_path / "models" / "quicktalk"
    _write_quicktalk_local_assets(asset_root)

    settings = SimpleNamespace(
        omnirt_endpoint="",
        quicktalk_asset_root=str(asset_root),
        quicktalk_model_root="",
        quicktalk_device="mps",
        quicktalk_hubert_device="",
        torch_device="auto",
        device="",
    )

    statuses = {status.id: status for status in await resolve_model_statuses(settings)}

    assert statuses["quicktalk"].backend == "local"
    assert statuses["quicktalk"].connected is True
    assert statuses["quicktalk"].reason == "local_runtime"


async def test_direct_ws_status_requires_reachable_quicktalk_url(monkeypatch) -> None:
    async def fake_reachable(_url: str) -> bool:
        return False

    monkeypatch.setattr(
        "opentalking.providers.synthesis.availability._is_direct_ws_reachable",
        fake_reachable,
    )
    settings = SimpleNamespace(
        omnirt_endpoint="",
        quicktalk_backend="direct_ws",
        quicktalk_ws_url="ws://127.0.0.1:8766/quicktalk",
    )

    statuses = {status.id: status for status in await resolve_model_statuses(settings)}

    assert statuses["quicktalk"].backend == "direct_ws"
    assert statuses["quicktalk"].connected is False
    assert statuses["quicktalk"].reason == "direct_ws_unavailable"


async def test_direct_ws_status_reports_reachable_quicktalk_url(monkeypatch) -> None:
    async def fake_reachable(_url: str) -> bool:
        return True

    monkeypatch.setattr(
        "opentalking.providers.synthesis.availability._is_direct_ws_reachable",
        fake_reachable,
    )
    settings = SimpleNamespace(
        omnirt_endpoint="",
        quicktalk_backend="direct_ws",
        quicktalk_ws_url="ws://127.0.0.1:8766/quicktalk",
    )

    statuses = {status.id: status for status in await resolve_model_statuses(settings)}

    assert statuses["quicktalk"].backend == "direct_ws"
    assert statuses["quicktalk"].connected is True
    assert statuses["quicktalk"].reason == "direct_ws"


async def test_omnirt_status_falls_back_to_legacy_avatar_models_path(monkeypatch) -> None:
    calls: list[str] = []

    async def fake_fetch(_settings, _endpoint: str, path: str) -> set[str]:
        calls.append(path)
        return {"quicktalk"} if path == "/v1/avatar/models" else set()

    monkeypatch.setattr(
        "opentalking.providers.synthesis.availability._fetch_omnirt_models_at_path",
        fake_fetch,
    )
    settings = SimpleNamespace(omnirt_endpoint="http://127.0.0.1:9000")

    assert await _fetch_omnirt_audio2video_models(settings) == {"quicktalk"}
    assert calls == ["/v1/audio2video/models", "/v1/avatar/models"]
