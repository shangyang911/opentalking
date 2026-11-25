"""Request/task-local usage attribution; never stores prompts, audio or credentials."""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
import wave
from contextvars import ContextVar
from dataclasses import dataclass
from functools import wraps
from typing import Any


@dataclass
class Meter:
    sink: Any
    user_id: int
    resource_id: str
    settings: Any
    deadline: float | None = None
    video_seconds: int | None = None
    audio_seconds: float = 0

    def record(self, category, model, quantities, measured=True):
        self.sink.record_usage(
            self.user_id, self.resource_id, category, model, quantities, measured
        )
        if category == "tts":
            self.audio_seconds += float(quantities.get("seconds", 0))

    async def emit(self, category, model, quantities, measured=True):
        await asyncio.to_thread(self.record, category, model, quantities, measured)

    def check_text(self, text):
        if len(text) > getattr(self.settings, "billing_max_input_chars", 1000):
            raise ValueError("输入长度超出上限，请缩短后重试。")

    def check_deadline(self):
        if self.deadline is not None and self.deadline <= time.time():
            raise ValueError("本次对话已到期，请重新开始。")

    def audio_limit(self):
        return max(0, min(60, self.deadline - time.time())) if self.deadline else 60


current_meter: ContextVar[Meter | None] = ContextVar("usage_meter", default=None)


async def reserve_quota(sink, user_id, resource_id, kind, model, max_seconds=None):
    pending = asyncio.create_task(
        asyncio.to_thread(sink.reserve, user_id, resource_id, kind, model, max_seconds)
    )
    try:
        return await asyncio.shield(pending)
    except asyncio.CancelledError:
        # Cancelling to_thread cannot cancel a database commit. Wait until its
        # outcome is known before releasing the reservation.
        with contextlib.suppress(Exception):
            await pending
        await asyncio.to_thread(sink.finish, resource_id, 0)
        raise


class MeteredTTS:
    def __init__(self, adapter, model):
        self.adapter, self.model = adapter, model

    def __getattr__(self, name):
        return getattr(self.adapter, name)

    async def synthesize_stream(self, text, *args, **kwargs):
        meter = current_meter.get()
        if meter:
            meter.check_text(text)
        seconds = 0.0
        limit = (meter.video_seconds or meter.audio_limit()) if meter else None
        try:
            async for chunk in self.adapter.synthesize_stream(text, *args, **kwargs):
                seconds += float(chunk.data.size) / float(chunk.sample_rate)
                if meter:
                    meter.check_deadline()
                if limit is not None and seconds > limit:
                    raise ValueError("合成音频超出本次可用时长，请缩短文本。")
                yield chunk
        finally:
            if meter:
                await meter.emit("tts", self.model, dict(characters=len(text), seconds=seconds))


def metered_tts_factory(factory):
    @wraps(factory)
    def wrapped(*args, **kwargs):
        adapter = factory(*args, **kwargs)
        if current_meter.get() and not isinstance(adapter, MeteredTTS):
            provider = kwargs.get("tts_provider") or type(adapter).__name__
            model = kwargs.get("tts_model") or getattr(adapter, "model", None)
            return MeteredTTS(adapter, f"{provider}:{model}" if model else str(provider))
        return adapter

    return wrapped


def metered_stt_wav(function):
    @wraps(function)
    def wrapped(path, *, provider=None):
        meter = current_meter.get()
        if not meter:
            return function(path, provider=provider)
        with wave.open(str(path), "rb") as audio:
            seconds = audio.getnframes() / audio.getframerate()
        if seconds > meter.audio_limit():
            raise ValueError("语音超出本次可用时长，请缩短后重试。")
        try:
            return function(path, provider=provider)
        finally:
            meter.record("stt", provider or "dashscope", dict(seconds=seconds))

    return wrapped


def metered_stt_queue(function):
    @wraps(function)
    def wrapped(chunk_queue, *, sample_rate=16000, provider=None):
        meter = current_meter.get()
        if not meter:
            return function(chunk_queue, sample_rate=sample_rate, provider=provider)
        limit = meter.audio_limit()

        class LimitedQueue:
            total = 0

            def get(self, *args, **kwargs):
                chunk = chunk_queue.get(*args, **kwargs)
                if chunk:
                    meter.check_deadline()
                    self.total += len(chunk)
                    if self.total / (sample_rate * 2) > limit:
                        raise ValueError("语音超出本次可用时长。")
                return chunk

            def __getattr__(self, key):
                return getattr(chunk_queue, key)

        queue = LimitedQueue()
        try:
            return function(queue, sample_rate=sample_rate, provider=provider)
        finally:
            meter.record(
                "stt", provider or "dashscope", dict(seconds=queue.total / (sample_rate * 2))
            )

    return wrapped


def billed_video(function):
    @wraps(function)
    async def wrapped(self, *args, **kwargs):
        meter = current_meter.get()
        if not meter or meter.video_seconds is not None:
            return await function(self, *args, **kwargs)
        dialog = kwargs.get("duo_dialog") or {}
        lines = dialog.get("lines") or []
        meter.check_text(
            (kwargs.get("text") or "")
            + "".join(str(line.get("text") or "") for line in lines if isinstance(line, dict))
        )
        await asyncio.to_thread(meter.sink.limit_action, meter.user_id, "video")
        rid = "vid_" + uuid.uuid4().hex
        reservation = await reserve_quota(
            meter.sink, meter.user_id, rid, "video", kwargs.get("model", "quicktalk")
        )
        child = Meter(
            meter.sink, meter.user_id, rid, meter.settings, video_seconds=reservation["seconds"]
        )
        token = current_meter.set(child)
        used = 0
        try:
            running = await asyncio.to_thread(meter.sink.start, rid)
            child.deadline = running["expires_at"]
            async with asyncio.timeout(max(0, running["expires_at"] - time.time())):
                result = await function(self, *args, **kwargs)
            used = float((result.get("export_video") or {}).get("duration_sec") or 0)
            return result
        finally:
            try:
                await asyncio.to_thread(meter.sink.finish, rid, used)
            finally:
                current_meter.reset(token)

    return wrapped


def check_video_duration(seconds):
    meter = current_meter.get()
    if meter:
        meter.check_deadline()
    if meter and meter.video_seconds is not None and seconds > meter.video_seconds:
        raise ValueError("视频超过本次可用时长，请缩短音频或文案。")
