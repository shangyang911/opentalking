from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from opentalking.streaming.chunks import ChunkFailure
from opentalking.video_creation_jobs import VideoCreationJobManager


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["queued", "waiting_publisher", "generating"])
async def test_stop_terminates_jobs_and_notifies_subscribers_at_every_stage(stage):
    manager = VideoCreationJobManager(SimpleNamespace())
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def runner(sink):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    job = await manager.submit(
        source="tts_text", metadata={}, runner=runner,
        wait_for_start=stage == "waiting_publisher",
    )
    subscriber = await job.hub.subscribe()
    if stage == "waiting_publisher":
        await asyncio.sleep(0)
    elif stage == "generating":
        await started.wait()
    assert job.status == stage

    result = await manager.stop(job.job_id)
    assert result.public()["status"] == "stopped"
    assert result.public()["error_code"] == "stopped"
    assert job.hub.closed
    message = await asyncio.wait_for(subscriber.get(), timeout=1)
    assert isinstance(message, ChunkFailure)
    assert message.code == "stopped"
    assert started.is_set() == (stage == "generating")
    assert cancelled.is_set() == (stage == "generating")
    assert (await manager.stop(job.job_id)).status == "stopped"


@pytest.mark.asyncio
@pytest.mark.parametrize("fails", [False, True])
async def test_stop_preserves_completed_or_failed_results(fails):
    manager = VideoCreationJobManager(SimpleNamespace())

    async def runner(sink):
        if fails:
            raise ValueError("generation failed")
        return {"export_video": {"id": "export_test"}}

    job = await manager.submit(source="tts_text", metadata={}, runner=runner)
    await job.task
    result = await manager.stop(job.job_id)
    assert result.status == ("failed" if fails else "completed")
    assert result.error_code == ("ValueError" if fails else None)
    if not fails:
        assert result.public()["final_export_id"] == "export_test"
