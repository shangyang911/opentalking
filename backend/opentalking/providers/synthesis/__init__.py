"""Driver models used by the local QuickTalk demo.

Shared transport helpers remain available to the media pipeline.
"""

from opentalking.core.registry import register
from opentalking.providers.synthesis import mock as _mock  # noqa: F401
from opentalking.providers.synthesis.omnirt import (
    auth_headers as omnirt_auth_headers,
    derive_audio2video_ws_url,
    derive_video_clone_ws_url,
    resolve_synthesis_ws_url,
)
from opentalking.providers.synthesis.flashtalk.ws_client import FlashTalkWSClient

register("synthesis", "quicktalk")(FlashTalkWSClient)

SYNTHESIS_PROVIDERS = ("mock", "quicktalk")
SUPPORTED_MODELS = frozenset(SYNTHESIS_PROVIDERS)


def list_available_synthesis() -> list[str]:
    return list(SYNTHESIS_PROVIDERS)


__all__ = [
    "SYNTHESIS_PROVIDERS", "SUPPORTED_MODELS", "derive_audio2video_ws_url",
    "derive_video_clone_ws_url", "list_available_synthesis", "omnirt_auth_headers",
    "resolve_synthesis_ws_url",
]
