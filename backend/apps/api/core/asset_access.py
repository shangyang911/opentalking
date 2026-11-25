"""Authorization of private assets supplied as identifiers in API payloads."""
from fastapi import HTTPException

from opentalking.voice.store import voice_accessible


def require_voice_access(voice: str | None) -> None:
    if voice is not None and not isinstance(voice, str):
        raise HTTPException(422, "音色标识格式错误。")
    if voice and not voice_accessible(voice.strip()):
        raise HTTPException(404, "专属声音不存在。")
