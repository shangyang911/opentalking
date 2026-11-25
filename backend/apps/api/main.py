from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import redis.asyncio as redis
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.core.config import get_settings
from apps.api.core.router import register_routes
from opentalking.voice.store import init_voice_store
from opentalking.video_creation_jobs import VideoCreationJobManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_voice_store()
    settings = get_settings()
    app.state.settings = settings
    app.state.video_creation_jobs = VideoCreationJobManager(settings)
    app.state.worker_boot_id = uuid.uuid4().hex
    r = redis.from_url(settings.redis_url, decode_responses=True)
    app.state.redis = r
    yield
    await app.state.video_creation_jobs.close()
    await r.aclose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="OpenTalking API", lifespan=lifespan)
    register_routes(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app


def main() -> None:
    settings = get_settings()
    host = os.environ.get("OPENTALKING_API_HOST", settings.api_host)
    port = int(os.environ.get("OPENTALKING_API_PORT", str(settings.api_port)))
    uvicorn.run(
        "apps.api.main:create_app",
        host=host,
        port=port,
        factory=True,
    )


if __name__ == "__main__":
    main()
