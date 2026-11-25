from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from functools import lru_cache

from apps.api.modules.auth.store import AuthError, AuthStore
from apps.api.modules.billing.store import BillingStore
from opentalking.core.metering import Meter, current_meter, reserve_quota


def enabled(settings):
    return getattr(settings, "auth_enabled", False) and getattr(settings, "billing_enabled", False)


async def reserve_session(request, model):
    if not enabled(request.app.state.settings):
        return None
    identity = getattr(request.state, "identity", None)
    if not identity or identity.role != "user":
        return None
    sid = "sess_" + uuid.uuid4().hex[:12]
    request.state.billing_session_id = sid
    await reserve_quota(request.app.state.billing_store, identity.id, sid, "conversation", model)
    return sid


async def guard_session(store, uid, sid):
    row = await asyncio.to_thread(store.reservation, sid)
    if (
        not row
        or row["user_id"] != uid
        or row["state"] != "running"
        or row["expires_at"] <= time.time()
    ):
        raise AuthError("会话未开始或额度已到期，请重新开始。", 402)
    return row


@lru_cache(maxsize=1)
def worker_store():
    from opentalking.core.config import get_settings

    return BillingStore(AuthStore(get_settings()))


async def attach_runner(runner, redis, sid, runners=None):
    from opentalking.runtime.bus import publish_event

    store = worker_store()
    reservation = await asyncio.to_thread(store.reservation, sid)
    if (
        not reservation
        or reservation["state"] != "reserved"
        or reservation["expires_at"] <= time.time()
    ):
        raise AuthError("初始化时额度预留已到期。", 402)
    runner._billing_meter = Meter(store, reservation["user_id"], sid, store.settings)
    original_close = runner.close
    closing = False
    watcher = None

    async def close():
        nonlocal closing
        if closing:
            return
        closing = True
        runner._billing_closing = True
        if watcher and watcher is not asyncio.current_task():
            watcher.cancel()
        try:
            prepare = getattr(runner, "_billing_prepare_task", None)
            if prepare and not prepare.done():
                with contextlib.suppress(Exception):
                    await asyncio.shield(prepare)
            await original_close()
        finally:
            try:
                await asyncio.to_thread(store.finish, sid)
                row = await asyncio.to_thread(store.reservation, sid)
                if row and row["started_at"]:
                    await runner._billing_meter.emit(
                        "render", runner.model_type, {"seconds": row["used_seconds"]}
                    )
            finally:
                if runners is not None and runners.get(sid) is runner:
                    runners.pop(sid, None)

    async def watch():
        warned = False
        try:
            while not closing:
                row = await asyncio.to_thread(store.reservation, sid)
                if not row or row["state"] == "finished" or row["expires_at"] <= time.time():
                    await publish_event(
                        redis,
                        sid,
                        "session.expired",
                        {"session_id": sid, "message": "quota_expired"},
                    )
                    await close()
                    return
                if row["state"] == "running":
                    runner._billing_meter.deadline = row["expires_at"]
                    remaining = max(0, int(row["expires_at"] - time.time()))
                    if not warned and remaining <= 10:
                        warned = True
                        await publish_event(
                            redis,
                            sid,
                            "session.expiring",
                            {"session_id": sid, "remaining_sec": remaining},
                        )
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            raise
        except Exception:
            # A failed quota check must stop inference, including database outages.
            with contextlib.suppress(Exception):
                await publish_event(
                    redis,
                    sid,
                    "session.expired",
                    {"session_id": sid, "message": "quota_unavailable"},
                )
            await close()

    runner.close = close
    watcher = asyncio.create_task(watch())


async def run_worker_task(function, task, redis, avatars_root, device, runners):
    sid = task.get("session_id")
    meter = getattr(runners.get(sid), "_billing_meter", None)
    token = current_meter.set(meter)
    try:
        if meter and task.get("cmd") in (
            "speak",
            "speak_flashtalk_audio",
            "flashtalk_offline_bundle",
        ):
            row = await guard_session(meter.sink, meter.user_id, sid)
            meter.deadline = row["expires_at"]
            meter.check_text(str(task.get("text") or ""))
        return await function(task, redis, avatars_root, device, runners)
    finally:
        current_meter.reset(token)
