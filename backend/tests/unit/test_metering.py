import json
from types import SimpleNamespace

import httpx
import pytest

from opentalking.providers.llm.openai_compatible.adapter import OpenAICompatibleLLMClient


@pytest.mark.asyncio
@pytest.mark.parametrize("reported", [True, False])
async def test_llm_records_final_usage_or_unknown_and_caps_reply(monkeypatch, reported):
    from opentalking.core.metering import Meter, current_meter

    records = []

    class Sink:
        def record_usage(self, *args):
            records.append(args)

    def respond(request):
        body = json.loads(request.content)
        assert body["stream_options"] == {"include_usage": True}
        assert body["max_tokens"] == 128
        chunks = [{"choices": [{"delta": {"content": "你好"}}]}]
        if reported:
            chunks.append({"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3}})
        return httpx.Response(
            200, text="\n".join("data: " + json.dumps(c) + "\n" for c in chunks) + "data: [DONE]\n"
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw)
    )
    token = current_meter.set(
        Meter(Sink(), 2, "sess_test", SimpleNamespace(billing_llm_max_tokens=128))
    )
    try:
        result = "".join(
            [
                x
                async for x in OpenAICompatibleLLMClient(
                    "https://example.test/v1", "", "demo"
                ).chat_stream([])
            ]
        )
    finally:
        current_meter.reset(token)
    assert result == "你好"
    assert len(records) == 1
    assert records[0][2:4] == ("llm", "demo")
    assert records[0][-1] is reported
    if reported:
        assert records[0][-2] == {"input_tokens": 12, "output_tokens": 3}


@pytest.mark.asyncio
async def test_tts_meter_records_partial_audio_on_cancel_and_caps_length():
    import numpy as np
    from opentalking.core.metering import Meter, current_meter, MeteredTTS

    records = []

    class Sink:
        def record_usage(self, *args):
            records.append(args)

    class Adapter:
        async def synthesize_stream(self, text):
            yield SimpleNamespace(data=np.zeros(1600, dtype=np.int16), sample_rate=16000)

    token = current_meter.set(
        Meter(Sink(), 2, "sess_test", SimpleNamespace(billing_max_input_chars=5))
    )
    try:
        adapter = MeteredTTS(Adapter(), "edge")
        stream = adapter.synthesize_stream("你好")
        await anext(stream)
        await stream.aclose()
        with pytest.raises(ValueError, match="长度"):
            await anext(adapter.synthesize_stream("超过五个字符的文本"))
    finally:
        current_meter.reset(token)
    assert records[0][-2] == {"characters": 2, "seconds": 0.1}


@pytest.mark.asyncio
async def test_cancel_during_video_reservation_waits_for_commit_and_refunds():
    import asyncio
    import threading
    from opentalking.core.metering import Meter, current_meter, billed_video

    started, commit = threading.Event(), threading.Event()
    finished = []

    class Sink:
        def limit_action(self, *args):
            pass

        def reserve(self, uid, rid, *args):
            started.set()
            assert commit.wait(3)
            return {"seconds": 60}

        def finish(self, rid, used=0):
            finished.append((rid, used))

    class Service:
        @billed_video
        async def run(self, **kwargs):
            raise AssertionError("Cancelled work must never start")

    token = current_meter.set(Meter(Sink(), 2, "request", SimpleNamespace()))
    try:
        task = asyncio.create_task(Service().run(model="mock"))
        assert await asyncio.to_thread(started.wait, 3)
        task.cancel()
        commit.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        current_meter.reset(token)
    assert len(finished) == 1
    assert finished[0][1] == 0
