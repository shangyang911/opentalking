"""百炼 Qwen-Audio / CosyVoice 共用 SpeechSynthesizer WebSocket 协议。"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import AsyncIterator
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

import numpy as np

from opentalking.core.types.frames import AudioChunk

log = logging.getLogger(__name__)


def _split_pcm_chunks(pcm: np.ndarray, sr: int, chunk_ms: float) -> list[AudioChunk]:
    samples_per_chunk = max(1, int(sr * (chunk_ms / 1000.0)))
    out: list[AudioChunk] = []
    for i in range(0, len(pcm), samples_per_chunk):
        part = pcm[i : i + samples_per_chunk]
        if part.size == 0:
            continue
        dur = 1000.0 * part.size / sr
        out.append(
            AudioChunk(
                data=part.astype(np.int16),
                sample_rate=sr,
                duration_ms=float(dur),
            )
        )
    return out


def _ensure_api_key() -> str:
    api_key = os.environ.get("OPENTALKING_TTS_DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        try:
            from opentalking.core.config import get_settings

            api_key = getattr(get_settings(), "tts_dashscope_api_key", "").strip()
        except Exception:
            pass
    if not api_key:
        raise RuntimeError(
            "CosyVoice WebSocket TTS 需要密钥：请设置 OPENTALKING_TTS_DASHSCOPE_API_KEY。",
        )
    return api_key


def _settings_value(name: str, default: str = "") -> str:
    try:
        from opentalking.core.config import get_settings

        value = getattr(get_settings(), name, default)
        if value is not None and str(value).strip():
            return str(value).strip()
    except Exception:
        pass
    return default


def _pcm_format_for_sr(sample_rate: int) -> Any:
    from dashscope.audio.tts_v2 import AudioFormat

    sr = int(sample_rate)
    if sr <= 8000:
        return AudioFormat.PCM_8000HZ_MONO_16BIT
    if sr <= 16000:
        return AudioFormat.PCM_16000HZ_MONO_16BIT
    if sr <= 22050:
        return AudioFormat.PCM_22050HZ_MONO_16BIT
    return AudioFormat.PCM_24000HZ_MONO_16BIT


class DashScopeCosyVoiceWsAdapter:
    """CosyVoice：``tts_v2.SpeechSynthesizer`` WebSocket（非 HTTP/SSE）。"""

    def __init__(
        self,
        default_voice: str | None = None,
        sample_rate: int = 16000,
        chunk_ms: float = 20.0,
        *,
        model: str | None = None,
        service_url: str | None = None,
    ) -> None:
        self.sample_rate = sample_rate
        self.chunk_ms = chunk_ms
        self.default_voice = default_voice or "longanyang"
        self._model = (
            (model.strip() if model and str(model).strip() else None)
            or os.environ.get("OPENTALKING_TTS_COSYVOICE_MODEL", "").strip()
            or _settings_value("tts_cosyvoice_model", "")
            or os.environ.get("OPENTALKING_TTS_DASHSCOPE_MODEL", "").strip()
            or _settings_value("tts_dashscope_model", "")
            or "cosyvoice-v3-flash"
        )
        self._service_url = (
            service_url.strip()
            if service_url and str(service_url).strip()
            else (
                os.environ.get("OPENTALKING_TTS_COSYVOICE_SERVICE_URL", "").strip()
                or _settings_value("tts_cosyvoice_service_url", "")
            )
        )

    async def synthesize_stream(
        self,
        text: str,
        voice: str | None = None,
    ) -> AsyncIterator[AudioChunk]:
        if not text.strip():
            return

        api_key = _ensure_api_key()
        try:
            import dashscope
            from dashscope.audio.tts_v2 import ResultCallback, SpeechSynthesizer
        except ImportError as e:
            raise RuntimeError(
                "dashscope package is required. Install: pip install 'dashscope>=1.25.11'",
            ) from e

        dashscope.api_key = api_key

        v = voice or self.default_voice
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=256)
        sentinel = object()
        done_exc: list[BaseException | None] = [None]
        stopped = threading.Event()
        synthesizers: list[Any] = []

        def push(item: Any) -> None:
            if stopped.is_set():
                return
            pending = asyncio.run_coroutine_threadsafe(queue.put(item), loop)
            while not stopped.is_set():
                try:
                    pending.result(timeout=0.2)
                    return
                except FutureTimeout:
                    continue
            pending.cancel()

        pcm_fmt = _pcm_format_for_sr(self.sample_rate)
        eff_sr = int(pcm_fmt.sample_rate) if getattr(pcm_fmt, "sample_rate", 0) else int(self.sample_rate)
        ws_url_raw = self._service_url
        ws_url = ws_url_raw if ws_url_raw else None
        model = self._model

        class _Cb(ResultCallback):
            def on_data(self, data: bytes) -> None:
                if data:
                    try:
                        push(bytes(data))
                    except Exception:  # noqa: BLE001
                        log.exception("CosyVoice WS audio queue push failed")

            def on_error(self, message: Any) -> None:
                detail = str(message)
                if "AccessDenied" in detail or "API-Key restrictions" in detail:
                    done_exc[0] = RuntimeError(
                        "百炼语音 API Key 未获准调用专属声音模型，请在控制台允许 "
                        f"{model}，或在运行配置中更换北京地域的语音 Key。"
                    )
                else:
                    done_exc[0] = RuntimeError(f"CosyVoice TTS error: {message}")

        def _run_ws() -> None:
            try:
                synth = SpeechSynthesizer(
                    model=self._model,
                    voice=v,
                    format=pcm_fmt,
                    callback=_Cb(),
                    url=ws_url,
                    additional_params={"enable_ssml": True},
                )
                synthesizers.append(synth)
                if stopped.is_set():
                    synth.close()
                    return
                synth.streaming_call(text)
                if stopped.is_set():
                    synth.close()
                    return
                synth.streaming_complete(complete_timeout_millis=180000)
            except BaseException as exc:  # noqa: BLE001
                if done_exc[0] is None:
                    done_exc[0] = exc
            finally:
                push(sentinel)

        producer = loop.run_in_executor(None, _run_ws)

        pcm_acc = bytearray()
        bytes_per_chunk = max(2, int(eff_sr * (self.chunk_ms / 1000.0)) * 2)
        if bytes_per_chunk % 2:
            bytes_per_chunk += 1

        try:
            while True:
                item = await queue.get()
                if item is sentinel:
                    break
                pcm_acc.extend(item)

                while len(pcm_acc) >= bytes_per_chunk:
                    chunk_bytes = bytes(pcm_acc[:bytes_per_chunk])
                    del pcm_acc[:bytes_per_chunk]
                    arr = np.frombuffer(chunk_bytes, dtype=np.int16).copy()
                    dur = 1000.0 * arr.size / eff_sr
                    yield AudioChunk(
                        data=arr,
                        sample_rate=eff_sr,
                        duration_ms=float(dur),
                    )
        finally:
            stopped.set()
            if not producer.done() and synthesizers:
                try:
                    await asyncio.to_thread(synthesizers[0].streaming_cancel, complete_timeout_millis=1000)
                except Exception:
                    log.debug("CosyVoice stream cancellation failed", exc_info=True)
                    await asyncio.to_thread(synthesizers[0].close)
            producer.cancel()

        if done_exc[0] is not None:
            raise done_exc[0]

        if pcm_acc:
            arr = np.frombuffer(bytes(pcm_acc), dtype=np.int16).copy()
            if arr.size % 2:
                arr = arr[: arr.size - (arr.size % 2)]
            if arr.size > 0:
                for c in _split_pcm_chunks(arr, eff_sr, self.chunk_ms):
                    yield c
