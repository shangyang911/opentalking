from __future__ import annotations

import pytest

from apps.api.main import create_app as create_api_app
from apps.unified.main import create_app as create_unified_app
from opentalking.providers.synthesis import SYNTHESIS_PROVIDERS


def test_only_deployed_driver_models_are_registered() -> None:
    assert set(SYNTHESIS_PROVIDERS) == {"mock", "quicktalk"}


def test_api_and_unified_expose_the_same_business_routes() -> None:
    assert create_api_app().openapi()["paths"] == create_unified_app().openapi()["paths"]


@pytest.mark.parametrize("factory", [create_api_app, create_unified_app])
def test_demo_api_keeps_core_workflows_and_removes_unused_modules(factory) -> None:
    paths = factory().openapi()["paths"]
    for path in ("/models", "/avatars", "/sessions", "/tts/preview", "/video-creation/jobs", "/exports/videos", "/runtime-config", "/voices", "/voices/clone"):
        assert path in paths
    for prefix in ("/video-clone", "/streaming", "/memory", "/agent", "/api/agent", "/personas", "/scene-assets", "/voice-uploads"):
        assert not any(path == prefix or path.startswith(prefix + "/") for path in paths), prefix

