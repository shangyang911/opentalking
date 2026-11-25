from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.tests.api.test_auth import auth_app, login  # noqa: F401


@pytest.fixture
def billing(auth_app):  # noqa: F811
    from apps.api.modules.billing.store import BillingStore
    from apps.api.modules.billing import router

    app, sent = auth_app
    app.state.test_sent = sent
    app.state.settings.billing_enabled = True
    app.state.settings.billing_free_seconds = 180
    app.state.settings.billing_trial_count = 2
    app.state.settings.billing_trial_seconds = 60
    app.state.billing_store = BillingStore(app.state.auth_store)
    app.state.auth_store.bootstrap(app.state.settings)
    app.include_router(router.router)
    with TestClient(app) as client:
        assert login(client, sent).status_code == 200
        user_id = client.get("/auth/me").json()["user"]["id"]
        yield app.state.billing_store, client, user_id, app


def enable_plan(store, kind="vip"):
    return store.save_plan(
        kind,
        dict(
            name="测试套餐",
            kind=kind,
            price_fen=100,
            conversation_seconds=600,
            video_seconds=120,
            max_session_seconds=120,
            valid_days=30,
            active=True,
        ),
    )


def test_trials_are_durable_and_failed_initialization_restores_them(billing):
    store, client, uid, _ = billing
    assert client.get("/billing/me").json()["trials_remaining"] == 2
    r = store.reserve(uid, "sess_a", "conversation", "quicktalk")
    assert r["seconds"] == 60
    assert store.account(uid)["trials_remaining"] == 1
    store.finish("sess_a")  # never started; initialization failed
    assert store.account(uid)["trials_remaining"] == 2
    for sid in ("sess_b", "sess_c"):
        store.reserve(uid, sid, "conversation", "quicktalk")
        store.start(sid)
        store.finish(sid)
    with pytest.raises(Exception, match="额度"):
        store.reserve(uid, "sess_d", "conversation", "quicktalk")
    assert store.account(uid)["conversation_seconds"] == 180


def test_parallel_reservations_cannot_overspend_or_overlap(billing):
    from apps.api.modules.auth.store import AuthError

    store, _, uid, _ = billing
    store.account(uid)  # Existing account must serialize just like first use.

    def reserve(i):
        try:
            store.reserve(uid, f"sess_parallel_{i}", "conversation", "mock")
            return True
        except AuthError as exc:
            assert exc.status == 409
            return False

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(reserve, range(4))) == 1


def test_order_confirmation_is_idempotent_gifts_are_not_revenue_and_refund_revokes(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    order = client.post(
        "/billing/orders", json={"plan_id": "vip", "request_id": "purchase-1"}
    ).json()
    assert (
        client.post("/billing/orders", json={"plan_id": "vip", "request_id": "purchase-1"}).json()[
            "id"
        ]
        == order["id"]
    )
    assert store.overview()["amount_fen"] == 0
    assert client.post(
        f"/admin/billing/orders/{order['id']}/confirm", json={"receipt": "bank-001"}
    ).status_code in (401, 403)
    store.confirm(order["id"], 1, "bank-001")
    store.confirm(order["id"], 1, "bank-001")
    assert store.account(uid)["conversation_seconds"] == 780
    assert store.overview()["amount_fen"] == 100
    store.gift(uid, 1, 60, 0, 7, "beta tester", "gift-1")
    assert store.overview()["amount_fen"] == 100
    store.refund(order["id"], 1, "refund-001")
    store.refund(order["id"], 1, "refund-001")
    assert store.overview()["amount_fen"] == 0
    assert store.overview()["refund_fen"] == 100
    assert store.account(uid)["conversation_seconds"] == 240


def test_disabled_plans_addons_receipt_reuse_and_order_isolation(billing):
    store, client, uid, app = billing
    assert (
        client.post("/billing/orders", json={"plan_id": "vip", "request_id": "a"}).status_code
        == 409
    )
    enable_plan(store, "pack")
    assert (
        client.post("/billing/orders", json={"plan_id": "pack", "request_id": "b"}).status_code
        == 409
    )
    enable_plan(store)
    a = store.create_order(uid, "vip", "c")
    b = store.create_order(uid, "vip", "d")
    store.confirm(a["id"], 1, "receipt-one")
    with pytest.raises(Exception, match="流水"):
        store.confirm(b["id"], 1, "receipt-one")
    with TestClient(app) as other:
        assert login(other, app.state.test_sent, phone="13900139000").status_code == 200
        assert other.get("/billing/orders").json()["orders"] == []
        assert other.post(f"/billing/orders/{a['id']}/cancel").status_code == 404


def test_metering_keeps_unknown_costs_distinct_from_zero(billing):
    store, _, uid, app = billing
    app.state.settings.billing_cost_rates = {
        "llm:demo": {"input_per_million": "1", "output_per_million": "2"}
    }
    store.record_usage(
        uid, "sess_usage", "llm", "demo", {"input_tokens": 1000, "output_tokens": 500}, True
    )
    store.record_usage(uid, "sess_usage", "llm", "missing", {}, False)
    summary = store.overview()
    assert summary["usage_count"] == 2
    assert summary["unknown_cost_count"] == 1
    assert summary["estimated_cost_fen"] == pytest.approx(0.2)


def test_session_guard_enforces_start_and_expiry_and_releases_on_delete(billing):
    from opentalking.core.in_memory_redis import InMemoryRedis

    store, client, uid, app = billing
    app.state.redis = InMemoryRedis()
    store.reserve(uid, "sess_guard", "conversation", "mock")

    @app.post("/sessions/sess_guard/speak")
    def speak():
        return {"ok": True}

    import asyncio

    asyncio.run(
        app.state.redis.hset("opentalking:session:sess_guard", mapping={"user_id": str(uid)})
    )
    assert client.post("/sessions/sess_guard/speak").status_code == 402
    store.start("sess_guard")
    assert client.post("/sessions/sess_guard/speak").status_code == 200
    with store.auth.connect() as db:
        db.execute("UPDATE billing_reservations SET expires_at=1 WHERE id=%s", ("sess_guard",))
    assert client.post("/sessions/sess_guard/speak").status_code == 402


def test_expired_prestart_reservation_restores_trial_and_renewal_refund_recalculates_vip(billing):
    import time

    store, _, uid, _ = billing
    store.reserve(uid, "sess_abandoned", "conversation", "quicktalk")
    with store.auth.connect() as db:
        db.execute("UPDATE billing_reservations SET expires_at=1 WHERE id=%s", ("sess_abandoned",))
    assert store.account(uid)["trials_remaining"] == 2
    enable_plan(store)
    first = store.create_order(uid, "vip", "renew-1")
    second = store.create_order(uid, "vip", "renew-2")
    store.confirm(first["id"], 1, "renew-receipt-1")
    store.confirm(second["id"], 1, "renew-receipt-2")
    assert store.account(uid)["vip_until"] > time.time() + 59 * 86400
    store.refund(first["id"], 1, "renew-refund-1")
    assert time.time() + 29 * 86400 < store.account(uid)["vip_until"] < time.time() + 31 * 86400


@pytest.mark.asyncio
async def test_worker_closes_expired_session_and_settles_quota(billing, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from apps.api.modules.billing import lifecycle
    from opentalking.core.in_memory_redis import InMemoryRedis

    store, _, uid, _ = billing
    monkeypatch.setattr(lifecycle, "worker_store", lambda: store)
    closed = []

    async def close():
        closed.append(True)

    runner = SimpleNamespace(close=close, model_type="mock")
    store.reserve(uid, "sess_watch", "conversation", "mock")
    await lifecycle.attach_runner(runner, InMemoryRedis(), "sess_watch")
    store.start("sess_watch")
    with store.auth.connect() as db:
        db.execute("UPDATE billing_reservations SET expires_at=1 WHERE id=%s", ("sess_watch",))
    for _ in range(30):
        if store.reservation("sess_watch")["state"] == "finished":
            break
        await asyncio.sleep(0.1)
    assert closed
    assert store.reservation("sess_watch")["state"] == "finished"


def test_real_session_routes_reserve_authenticated_user_and_release_on_end(
    billing, monkeypatch, tmp_path
):
    import asyncio
    from apps.api.modules.conversation import sessions
    from opentalking.core.in_memory_redis import InMemoryRedis
    import opentalking.providers.synthesis.availability as availability

    store, client, uid, app = billing
    app.state.redis = InMemoryRedis()
    app.state.settings.avatars_dir = str(tmp_path)
    (tmp_path / "sample").mkdir()
    (tmp_path / "sample" / "manifest.json").write_text("{}")
    app.include_router(sessions.router)
    monkeypatch.setattr(sessions, "load_avatar_bundle", lambda *args, **kwargs: None)
    monkeypatch.setattr(sessions, "_require_audio_provider_config", lambda **kwargs: None)

    async def available(settings):
        return ["quicktalk"]

    async def ready(*args, **kwargs):
        return True

    monkeypatch.setattr(availability, "connected_model_ids", available)
    monkeypatch.setattr(sessions, "_wait_for_session_worker_ready", ready)
    response = client.post(
        "/sessions", json={"model": "quicktalk", "avatar_id": "sample", "user_id": "spoofed"}
    )
    assert response.status_code == 200, response.text
    sid = response.json()["session_id"]
    assert store.reservation(sid)["user_id"] == uid
    assert store.account(uid)["trials_remaining"] == 1
    record = asyncio.run(app.state.redis.hgetall(f"opentalking:session:{sid}"))
    assert str(record.get("user_id")) == str(uid)
    assert client.post(f"/sessions/{sid}/start").status_code == 200
    assert store.reservation(sid)["state"] == "running"
    assert client.delete(f"/sessions/{sid}").status_code == 200
    assert store.reservation(sid)["state"] == "finished"


def test_auxiliary_timeout_refunds_clone_quota(billing, monkeypatch):
    import asyncio
    import time

    store, client, uid, app = billing
    store.gift(uid, 1, 60, 0, 7, "clone beta", "clone-timeout")
    original = store.start

    def short_deadline(rid):
        row = original(rid)
        row["expires_at"] = time.time() + 0.02
        return row

    monkeypatch.setattr(store, "start", short_deadline)

    @app.post("/voices/clone")
    async def slow_clone():
        await asyncio.sleep(0.15)
        return {"ok": True}

    assert client.post("/voices/clone").status_code == 504
    assert store.account(uid)["conversation_seconds"] == 240
    assert store.account(uid)["active"] is None
