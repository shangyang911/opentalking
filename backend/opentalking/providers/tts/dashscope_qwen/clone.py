"""百炼声音复刻：CosyVoice（URL + VoiceEnrollmentService）、Qwen（base64 + HTTP）。"""

from __future__ import annotations

import base64
import logging
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

DASHSCOPE_CUSTOMIZATION_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization"
VOICE_CLONE_MODEL = "qwen-audio-3.1-tts-flash"


def _cosyvoice_request(client: httpx.Client, action: str, **values: object) -> dict:
    response = client.post(
        DASHSCOPE_CUSTOMIZATION_URL,
        headers={"Authorization": f"Bearer {_dashscope_api_key()}"},
        json={"model": "voice-enrollment", "input": {"action": action, **values}},
    )
    if response.status_code != 200:
        if response.status_code in {401, 403}:
            raise RuntimeError("百炼拒绝访问，请检查北京地域的语音 API Key 和专属声音模型权限。")
        raise RuntimeError(f"百炼声音服务请求失败（HTTP {response.status_code}），请检查录音质量、模型权限和账户额度。")
    data = response.json()
    if data.get("code"):
        raise RuntimeError("百炼声音服务未完成请求，请检查录音质量、模型权限和账户额度。")
    return data.get("output") or {}


def clone_cosyvoice_from_audio(*, wav_bytes: bytes, prefix: str) -> str:
    """内联上传本地音频，无需将用户录音发布为公网文件。"""
    audio = "data:audio/wav;base64," + base64.b64encode(wav_bytes).decode("ascii")
    with httpx.Client(timeout=15.0) as client:
        output = _cosyvoice_request(
            client, "create_voice", target_model=VOICE_CLONE_MODEL,
            prefix=prefix, audio=audio, language_hints=["zh"],
        )
        voice_id = output.get("voice_id")
        if not voice_id:
            raise RuntimeError("百炼未返回音色 ID，请稍后重试。")
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                status = _cosyvoice_request(client, "query_voice", voice_id=voice_id).get("status")
                if status == "OK":
                    return str(voice_id)
                if status != "DEPLOYING":
                    raise RuntimeError("声音复刻未通过，请使用无背景音乐、单人清晰朗读的录音重试。")
                time.sleep(1)
            raise RuntimeError("百炼音色准备超时，请稍后重试。")
        except Exception:
            # 不把未就绪音色留在账户中占用配额。
            try:
                _cosyvoice_request(client, "delete_voice", voice_id=voice_id)
            except Exception:
                log.warning("Could not clean up unready voice %s", voice_id)
            raise


def delete_cosyvoice_voice(voice_id: str) -> None:
    with httpx.Client(timeout=15.0) as client:
        _cosyvoice_request(client, "delete_voice", voice_id=voice_id)


def _dashscope_api_key() -> str:
    key = os.environ.get("OPENTALKING_TTS_DASHSCOPE_API_KEY", "").strip()
    if not key:
        try:
            from opentalking.core.config import get_settings

            key = getattr(get_settings(), "tts_dashscope_api_key", "").strip()
        except Exception:
            pass
    if not key:
        raise RuntimeError("需要 OPENTALKING_TTS_DASHSCOPE_API_KEY（DashScope / 百炼 TTS API Key）。")
    return key


def _ffmpeg_bin() -> str:
    try:
        from opentalking.core.config import get_settings

        return (get_settings().ffmpeg_bin or "ffmpeg").strip() or "ffmpeg"
    except Exception:
        return os.environ.get("OPENTALKING_FFMPEG_BIN", "ffmpeg")


def convert_audio_to_wav_24k_mono(upload_bytes: bytes, suffix: str) -> bytes:
    """将浏览器上传（webm/wav/mp3 等）转为 24kHz 单声道 s16 WAV（百炼常见要求）。"""
    ffmpeg = _ffmpeg_bin()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fin:
        fin.write(upload_bytes)
        fin.flush()
        in_path = fin.name
    out_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fout:
            out_path = fout.name
        cmd = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            in_path,
            "-ac",
            "1",
            "-ar",
            "24000",
            "-t",
            "61",
            "-f",
            "wav",
            out_path,
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=30)
        return Path(out_path).read_bytes()
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"ffmpeg 转码失败: {e.stderr.decode(errors='replace')[:500]}") from e
    finally:
        Path(in_path).unlink(missing_ok=True)
        if out_path:
            Path(out_path).unlink(missing_ok=True)


def clone_cosyvoice_voice(
    *,
    target_model: str,
    prefix: str,
    public_audio_url: str,
) -> str:
    """调用 DashScope VoiceEnrollmentService（音频须为 public_audio_url 可访问）。"""
    import dashscope
    from dashscope.audio.tts_v2 import VoiceEnrollmentService

    dashscope.api_key = _dashscope_api_key()
    prefix_clean = prefix.strip().lower()
    if not re.fullmatch(r"[a-z0-9]{1,9}", prefix_clean):
        raise ValueError("音色前缀须为 1～9 位小写字母或数字")
    svc = VoiceEnrollmentService()
    voice_id = svc.create_voice(
        target_model=target_model.strip(),
        prefix=prefix_clean,
        url=public_audio_url,
        language_hints=["zh"],
    )
    return str(voice_id)


def clone_qwen_voice(
    *,
    wav_bytes: bytes,
    target_model: str,
    preferred_name: str,
    audio_mime: str = "audio/wav",
) -> str:
    """qwen-voice-enrollment：base64 data URI，无需公网 URL。"""
    api_key = _dashscope_api_key()
    b64 = base64.standard_b64encode(wav_bytes).decode("ascii")
    data_uri = f"data:{audio_mime};base64,{b64}"
    preferred = preferred_name.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,19}", preferred):
        raise ValueError("preferred_name 须以小写字母开头，仅含小写、数字、下划线，≤20 字符")

    payload: dict = {
        "model": "qwen-voice-enrollment",
        "input": {
            "action": "create",
            "target_model": target_model.strip(),
            "preferred_name": preferred,
            "audio": {"data": data_uri},
        },
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=180.0) as client:
        r = client.post(DASHSCOPE_CUSTOMIZATION_URL, json=payload, headers=headers)
    if r.status_code != 200:
        raise RuntimeError(f"百炼千问复刻失败 HTTP {r.status_code}: {r.text[:800]}")
    data = r.json()
    out = data.get("output") or {}
    voice = out.get("voice")
    if not voice:
        raise RuntimeError(f"百炼返回无 voice 字段: {data!r}")
    return str(voice)
