"""本地演示版专属声音：百炼 Qwen-Audio / CosyVoice 共用复刻协议。"""

from __future__ import annotations

import asyncio
import io
import logging
import uuid
import wave
from dataclasses import asdict
from pathlib import Path

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile

from opentalking.providers.tts.dashscope_qwen.clone import (
    _dashscope_api_key,
    clone_cosyvoice_from_audio,
    convert_audio_to_wav_24k_mono,
    delete_cosyvoice_voice,
    VOICE_CLONE_MODEL,
)
from opentalking.voice import store

router = APIRouter(prefix="/voices", tags=["voices"])
log = logging.getLogger(__name__)
MAX_AUDIO_BYTES = 10 * 1024 * 1024


@router.get("")
async def list_cloned_voices() -> dict:
    # 保留既有 cosyvoice provider ID；Qwen-Audio 使用相同的复刻与合成协议。
    entries = await asyncio.to_thread(store.list_voices, provider="cosyvoice")
    return {"voices": [asdict(entry) for entry in entries if entry.source == "clone"]}


@router.post("/clone", status_code=201, response_model=store.VoiceEntry)
async def create_cloned_voice(
    audio: UploadFile = File(...),
    display_label: str = Form(..., min_length=1, max_length=40),
) -> dict | None:
    label = display_label.strip()
    if not label or any(ord(char) < 32 for char in label):
        raise HTTPException(400, "请为专属声音填写名称（最多 40 字）。")
    try:
        _dashscope_api_key()
    except RuntimeError as exc:
        raise HTTPException(400, "请先在运行配置中保存百炼语音 API Key，再创建专属声音。") from exc
    content = await audio.read(MAX_AUDIO_BYTES + 1)
    if not content:
        raise HTTPException(400, "请选择一段清晰的录音。")
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "录音文件不能超过 10 MB。")
    suffix = Path(audio.filename or "sample.wav").suffix.lower()
    if suffix not in {".wav", ".mp3", ".m4a", ".webm", ".ogg", ".mp4"}:
        raise HTTPException(400, "请上传 WAV、MP3、M4A、WebM、OGG 或 MP4 音频。")
    try:
        wav = await asyncio.to_thread(convert_audio_to_wav_24k_mono, content, suffix)
        with wave.open(io.BytesIO(wav), "rb") as sample:
            duration = sample.getnframes() / sample.getframerate()
    except Exception as exc:
        raise HTTPException(400, "无法读取录音，请换一段有效音频后重试。") from exc
    if not 5 <= duration <= 60:
        raise HTTPException(400, "录音需为 5～60 秒，推荐 10～20 秒的单人清晰朗读。")
    try:
        voice_id = await asyncio.to_thread(clone_cosyvoice_from_audio, wav_bytes=wav, prefix="ot" + uuid.uuid4().hex[:7])
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "百炼声音服务响应超时，请稍后重试。") from exc
    except (RuntimeError, httpx.HTTPError) as exc:
        detail = str(exc) if isinstance(exc, RuntimeError) else "无法连接百炼声音服务，请检查网络后重试。"
        raise HTTPException(502, detail) from exc
    entry_id = await asyncio.to_thread(
        store.insert_clone, provider="cosyvoice", voice_id=voice_id,
        display_label=label, target_model=VOICE_CLONE_MODEL,
    )
    return await asyncio.to_thread(store.get_entry, entry_id)


@router.delete("/{entry_id}", status_code=204)
async def delete_cloned_voice(entry_id: int) -> Response:
    entry = await asyncio.to_thread(store.get_entry, entry_id)
    if not entry or entry["source"] != "clone" or entry["provider"] != "cosyvoice":
        raise HTTPException(404, "专属声音不存在。")
    try:
        await asyncio.to_thread(delete_cosyvoice_voice, entry["voice_id"])
    except (RuntimeError, httpx.HTTPError) as exc:
        raise HTTPException(502, "百炼音色删除失败，本地记录已保留，请检查网络、API Key 后重试。") from exc
    await asyncio.to_thread(store.delete_entry, entry_id)
    return Response(status_code=204)
