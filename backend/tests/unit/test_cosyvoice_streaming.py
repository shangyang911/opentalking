from __future__ import annotations

import asyncio
import threading

import pytest


@pytest.mark.asyncio
async def test_cosyvoice_yields_audio_before_generation_finishes(monkeypatch):
    from dashscope.audio import tts_v2
    from opentalking.providers.tts.cosyvoice_ws.adapter import DashScopeCosyVoiceWsAdapter

    release = threading.Event()
    finished = threading.Event()

    class FakeSynth:
        def __init__(self, **kwargs):
            self.callback = kwargs["callback"]

        def streaming_call(self, text):
            self.callback.on_data(b"\x01\x00" * 320)

        def streaming_complete(self, **kwargs):
            release.wait(0.5)
            finished.set()

        def streaming_cancel(self, **kwargs):
            release.set()

    monkeypatch.setenv("OPENTALKING_TTS_DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setattr(tts_v2, "SpeechSynthesizer", FakeSynth)
    stream = DashScopeCosyVoiceWsAdapter(model="cosyvoice-v3.5-flash").synthesize_stream("你好")
    try:
        chunk = await anext(stream)
        assert chunk.data.size == 320
        assert not finished.is_set(), "first audio must arrive while synthesis is still running"
    finally:
        release.set()
        await stream.aclose()


@pytest.mark.asyncio
async def test_cancellation_during_startup_closes_socket_and_skips_generation(monkeypatch):
    from dashscope.audio import tts_v2
    from opentalking.providers.tts.cosyvoice_ws.adapter import DashScopeCosyVoiceWsAdapter

    started = threading.Event()
    closed = threading.Event()
    completed = threading.Event()

    class FakeSynth:
        def __init__(self, **kwargs):
            pass

        def streaming_call(self, text):
            started.set()
            closed.wait(1)

        def streaming_complete(self, **kwargs):
            completed.set()

        def streaming_cancel(self, **kwargs):
            raise RuntimeError("not started")

        def close(self):
            closed.set()

    monkeypatch.setenv("OPENTALKING_TTS_DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setattr(tts_v2, "SpeechSynthesizer", FakeSynth)
    stream = DashScopeCosyVoiceWsAdapter(model="cosyvoice-v3.5-flash").synthesize_stream("你好")
    task = asyncio.create_task(anext(stream))
    assert await asyncio.to_thread(started.wait, 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()
    assert not completed.is_set()


@pytest.mark.asyncio
async def test_stream_backpressure_preserves_more_than_a_queue_of_audio(monkeypatch):
    from dashscope.audio import tts_v2
    from opentalking.providers.tts.cosyvoice_ws.adapter import DashScopeCosyVoiceWsAdapter

    class FakeSynth:
        def __init__(self, **kwargs):
            self.callback = kwargs["callback"]

        def streaming_call(self, text):
            for _ in range(300):
                self.callback.on_data(b"\x01\x00" * 320)

        def streaming_complete(self, **kwargs):
            pass

        def streaming_cancel(self, **kwargs):
            pass

    monkeypatch.setenv("OPENTALKING_TTS_DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setattr(tts_v2, "SpeechSynthesizer", FakeSynth)
    chunks = [chunk async for chunk in DashScopeCosyVoiceWsAdapter(model="cosyvoice-v3.5-flash").synthesize_stream("你好")]
    assert sum(chunk.data.size for chunk in chunks) == 300 * 320


@pytest.mark.asyncio
async def test_key_restrictions_are_reported_instead_of_later_socket_error(monkeypatch):
    from dashscope.audio import tts_v2
    from opentalking.providers.tts.cosyvoice_ws.adapter import DashScopeCosyVoiceWsAdapter

    class FakeSynth:
        def __init__(self, **kwargs):
            self.callback = kwargs["callback"]

        def streaming_call(self, text):
            self.callback.on_error({"error_code": "AccessDenied", "error_message": "Access denied by API-Key restrictions."})

        def streaming_complete(self, **kwargs):
            raise ConnectionError("WebSocket connection is not established")

        def streaming_cancel(self, **kwargs):
            pass

    monkeypatch.setenv("OPENTALKING_TTS_DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setattr(tts_v2, "SpeechSynthesizer", FakeSynth)
    with pytest.raises(RuntimeError, match="API Key.*专属声音"):
        async for _ in DashScopeCosyVoiceWsAdapter(model="cosyvoice-v3.5-flash").synthesize_stream("你好"):
            pass
