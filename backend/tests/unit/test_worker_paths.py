import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI

from opentalking.core.in_memory_redis import InMemoryRedis
from opentalking.core.paths import backend_root, project_root
from opentalking.runtime import server


@pytest.mark.asyncio
async def test_worker_uses_project_avatars_from_backend_directory(monkeypatch):
    monkeypatch.chdir(backend_root())
    monkeypatch.delenv("OPENTALKING_AVATARS_DIR", raising=False)
    monkeypatch.setattr(server.redis, "from_url", lambda *args, **kwargs: InMemoryRedis())

    async def consume(*args):
        await asyncio.Event().wait()

    monkeypatch.setattr(server, "consume_task_queue", consume)
    app = FastAPI()
    async with server.lifespan(app):
        assert app.state.avatars_root == project_root() / "examples/avatars"
        assert Path(app.state.avatars_root).is_dir()
