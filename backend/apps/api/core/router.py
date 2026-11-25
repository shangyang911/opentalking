"""The API and unified server expose the same business routes."""

from fastapi import FastAPI

from apps.api.core.auth import install_auth
from apps.api.core.config import get_settings
from apps.api.modules.auth import router as auth
from apps.api.modules.billing import router as billing
from apps.api.modules.knowledge import router as knowledge

from apps.api.modules.avatars import router as avatars
from apps.api.modules.conversation import events, sessions
from apps.api.modules.system import health, models, runtime_config
from apps.api.modules.video_creation import router as video_creation
from apps.api.modules.voices import preview as tts_preview
from apps.api.modules.voices import router as voices
from apps.api.modules.works import router as works


def register_routes(app: FastAPI) -> None:
    install_auth(app, get_settings())
    for module in (
        auth, billing, health, models, avatars, sessions, events, works,
        runtime_config, tts_preview, video_creation, voices, knowledge,
    ):
        app.include_router(module.router)
