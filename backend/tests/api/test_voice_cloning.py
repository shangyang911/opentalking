from __future__ import annotations

import io
import wave

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from opentalking.voice import store


def sample_wav(seconds: float = 12) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(b"\x01\x00" * int(24000 * seconds))
    return output.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    from apps.api.modules.voices import router as voices

    monkeypatch.setattr(store, "get_sqlite_path", lambda: tmp_path / "voices.sqlite3")
    store.init_voice_store()
    monkeypatch.setattr(voices, "_dashscope_api_key", lambda: "test-key")
    monkeypatch.setattr(voices, "convert_audio_to_wav_24k_mono", lambda body, suffix: body)
    app = FastAPI()
    app.include_router(voices.router)
    return TestClient(app)


def test_clone_upload_saves_model_and_can_be_listed_and_deleted(client, monkeypatch):
    from apps.api.modules.voices import router as voices

    calls = []
    monkeypatch.setattr(voices, "clone_cosyvoice_from_audio", lambda **kwargs: calls.append(kwargs) or "cosyvoice-myvoice")
    monkeypatch.setattr(voices, "delete_cosyvoice_voice", lambda voice_id: calls.append(voice_id))
    response = client.post("/voices/clone", data={"display_label": "熟悉的声音"}, files={"audio": ("sample.wav", sample_wav(), "audio/wav")})
    assert response.status_code == 201, response.text
    voice = response.json()
    assert voice["provider"] == "cosyvoice"
    assert voice["target_model"] == "qwen-audio-3.1-tts-flash"
    assert voice["display_label"] == "熟悉的声音"
    assert voice["voice_id"] == "cosyvoice-myvoice"
    assert client.get("/voices").json()["voices"] == [voice]
    assert calls[0]["wav_bytes"].startswith(b"RIFF")
    assert client.delete(f"/voices/{voice['id']}").status_code == 204
    assert calls[-1] == "cosyvoice-myvoice"
    assert client.get("/voices").json()["voices"] == []


@pytest.mark.parametrize("seconds", [2, 61])
def test_bad_duration_is_rejected_before_cloud_request(client, monkeypatch, seconds):
    from apps.api.modules.voices import router as voices

    monkeypatch.setattr(voices, "clone_cosyvoice_from_audio", lambda **kwargs: pytest.fail("cloud must not be called"))
    response = client.post("/voices/clone", data={"display_label": "测试"}, files={"audio": ("sample.wav", sample_wav(seconds))})
    assert response.status_code == 400
    assert "5～60" in response.json()["detail"]


def test_missing_key_and_invalid_audio_have_actionable_errors(client, monkeypatch):
    from apps.api.modules.voices import router as voices

    def missing_key():
        raise RuntimeError("missing")

    monkeypatch.setattr(voices, "_dashscope_api_key", missing_key)
    response = client.post("/voices/clone", data={"display_label": "测试"}, files={"audio": ("sample.wav", sample_wav())})
    assert response.status_code == 400
    assert "运行配置" in response.json()["detail"]
    monkeypatch.setattr(voices, "_dashscope_api_key", lambda: "test-key")
    response = client.post("/voices/clone", data={"display_label": "测试"}, files={"audio": ("sample.wav", b"bad audio")})
    assert response.status_code == 400
    assert client.get("/voices").json()["voices"] == []


def test_cannot_delete_system_voices(client):
    assert client.delete("/voices/101").status_code == 404


def test_cloud_failure_does_not_save_a_voice(client, monkeypatch):
    from apps.api.modules.voices import router as voices

    def fail(**kwargs):
        raise RuntimeError("百炼音色创建失败，请检查模型权限。")

    monkeypatch.setattr(voices, "clone_cosyvoice_from_audio", fail)
    response = client.post("/voices/clone", data={"display_label": "测试"}, files={"audio": ("sample.wav", sample_wav())})
    assert response.status_code == 502
    assert client.get("/voices").json()["voices"] == []


def test_clone_transport_uses_inline_audio_and_waits_for_readiness(monkeypatch):
    from opentalking.providers.tts.dashscope_qwen import clone

    calls = []
    def handle(request):
        import json

        payload = json.loads(request.content)
        calls.append(payload)
        if payload["input"]["action"] == "create_voice":
            return httpx.Response(200, json={"output": {"voice_id": "cosyvoice-test"}})
        return httpx.Response(200, json={"output": {"status": "OK"}})

    real_client = httpx.Client
    monkeypatch.setattr(clone, "_dashscope_api_key", lambda: "test-key")
    monkeypatch.setattr(clone.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(handle)))
    assert clone.clone_cosyvoice_from_audio(wav_bytes=sample_wav(), prefix="familiar") == "cosyvoice-test"
    assert calls[0]["model"] == "voice-enrollment"
    assert calls[0]["input"]["audio"].startswith("data:audio/wav;base64,")
    assert calls[0]["input"]["target_model"] == "qwen-audio-3.1-tts-flash"
    assert calls[1]["input"] == {"action": "query_voice", "voice_id": "cosyvoice-test"}
