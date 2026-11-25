from __future__ import annotations

from types import SimpleNamespace
import os
import uuid
import re
from pathlib import Path

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient


@pytest.fixture
def auth_app(tmp_path, monkeypatch):
    import pymysql
    from apps.api.core.auth import install_auth
    from apps.api.modules.auth import router, sms

    from dotenv import dotenv_values
    local_test_settings = dotenv_values(Path(__file__).resolve().parents[3] / ".env.test")

    def test_setting(name, default=None):
        return os.environ.get(name, local_test_settings.get(name, default))

    password = test_setting("OPENTALKING_TEST_MYSQL_PASSWORD")
    if password is None:
        pytest.skip("Set OPENTALKING_TEST_MYSQL_PASSWORD to run isolated MySQL authentication tests")
    database = "opentalking_auth_test_" + uuid.uuid4().hex
    existing_database = test_setting("OPENTALKING_TEST_MYSQL_DATABASE")
    if existing_database and not re.fullmatch(r"[A-Za-z0-9_]+_test", existing_database):
        pytest.fail("The shared authentication test database must end in _test; business databases are forbidden.")
    table_prefix = "authtest_" + uuid.uuid4().hex + "_"
    connection = pymysql.connect(host=test_setting("OPENTALKING_TEST_MYSQL_HOST", "localhost"),
                                 port=int(test_setting("OPENTALKING_TEST_MYSQL_PORT", "3306")),
                                 user=test_setting("OPENTALKING_TEST_MYSQL_USER", "root"), password=password,
                                 autocommit=True)
    if existing_database:
        from backend.tests.auth_mysql_helpers import PrefixedConnection
        from apps.api.modules.auth.store import AuthStore
        database = existing_database
        original_open = AuthStore._open
        monkeypatch.setattr(AuthStore, "_open", lambda self: PrefixedConnection(original_open(self), table_prefix))
        connection.select_db(database)
    else:
        with connection.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE `{database}` CHARACTER SET utf8mb4")
    settings = SimpleNamespace(
        auth_enabled=True, mysql_host=connection.host, mysql_port=connection.port,
        mysql_user=connection.user.decode() if isinstance(connection.user, bytes) else connection.user,
        mysql_password=password, mysql_database=database,
        auth_cookie_secure=False, auth_session_hours=24,
        admin_username="operator", admin_password="correct-password-123",
        tencent_sms_secret_id="id", tencent_sms_secret_key="secret",
        tencent_sms_sdk_app_id="1400000000", tencent_sms_sign_name="测试",
        tencent_sms_template_id="123", tencent_sms_region="ap-guangzhou",
        sms_daily_limit=100, cors_origin_list=["http://testserver"],
        exports_dir=str(tmp_path / "exports"), export_max_bytes=1024,
    )
    sent = []
    provider_send_sms = sms.send_sms

    async def send(settings, phone, code):
        sent.append((phone, code))

    monkeypatch.setattr(sms, "send_sms", send)
    app = FastAPI()
    app.state.provider_send_sms = provider_send_sms
    app.state.settings = settings
    install_auth(app, settings)
    app.include_router(router.router)

    @app.get("/protected")
    def protected():
        return {"ok": True}

    @app.post("/runtime-config/apply")
    def apply():
        return {"ok": True}

    try:
        yield app, sent
    finally:
        with connection.cursor() as cursor:
            if existing_database:
                # Drop only the six randomly prefixed tables this fixture owns.
                assert table_prefix.startswith("authtest_") and re.fullmatch(r"authtest_[a-f0-9]{32}_", table_prefix)
                for suffix in ("b_usage", "b_reservations", "b_grants", "b_orders", "b_plans", "b_accounts", "profiles", "sessions", "codes", "limits", "meta", "mutex", "users"):
                    cursor.execute(f"DROP TABLE IF EXISTS `{table_prefix}{suffix}`")
            else:
                assert database.startswith("opentalking_auth_test_") and len(database) == 54
                cursor.execute(f"DROP DATABASE `{database}`")
        connection.close()


def login(client, sent, phone="13800138000"):
    response = client.post("/auth/sms", json={"phone": phone})
    assert response.status_code == 200, response.text
    return client.post("/auth/login", json={"phone": phone, "code": sent[-1][1], "password": "test-password"})


def create_phone_user(store, phone="13800138000", password="test-password"):
    code, nonce = store.prepare_code(phone, "fixture-setup", 100)
    store.activate_code(phone, nonce)
    return store.phone_login(phone, code, 24, password)


def test_phone_registration_then_password_login_does_not_send_sms(auth_app):
    from apps.api.modules.auth.store import check_password
    app, sent = auth_app
    with TestClient(app) as client:
        registered = login(client, sent)
        assert registered.status_code == 200
        user_id = registered.json()["user"]["id"]
        with app.state.auth_store.connect() as db:
            row = db.execute("SELECT * FROM auth_users WHERE id=%s", (user_id,)).fetchone()
            assert row["username"] is None
            assert row["password_hash"] != "test-password"
            assert check_password("test-password", row["password_hash"])
        client.post("/auth/logout")
        app.state.settings.tencent_sms_secret_id = ""
        response = client.post("/auth/password/login", json={"phone": "13800138000", "password": "test-password"})
        assert response.status_code == 200
        assert response.json()["user"]["id"] == user_id
        assert len(sent) == 1


def test_existing_phone_without_password_can_set_first_password(auth_app):
    app, sent = auth_app
    with app.state.auth_store.connect() as db:
        db.execute("INSERT INTO auth_users(role, phone) VALUES('user', '13800138000')")
        original = db.execute("SELECT id FROM auth_users WHERE phone='13800138000'").fetchone()["id"]
    with TestClient(app) as client:
        result = login(client, sent)
        assert result.status_code == 200
        assert result.json()["user"]["id"] == original


def test_repeat_registration_cannot_overwrite_password(auth_app):
    app, _ = auth_app
    store = app.state.auth_store
    original, token = create_phone_user(store)
    with store.connect() as db:
        db.execute("DELETE FROM auth_limits")
    code, nonce = store.prepare_code("13800138000", "fixture-setup", 100)
    store.activate_code("13800138000", nonce)
    with TestClient(app) as client:
        result = client.post("/auth/login", json={"phone": "13800138000", "code": code, "password": "replacement"})
        assert result.status_code == 409
        assert store.resolve(token).id == original.id
        assert client.post("/auth/password/login", json={"phone": "13800138000", "password": "replacement"}).status_code == 401
        assert client.post("/auth/password/login", json={"phone": "13800138000", "password": "test-password"}).status_code == 200


@pytest.mark.parametrize("password", [None, "", "12345", "a" * 129])
def test_registration_requires_valid_password_without_consuming_code(auth_app, password):
    app, sent = auth_app
    with TestClient(app) as client:
        client.post("/auth/sms", json={"phone": "13800138000"})
        payload = {"phone": "13800138000", "code": sent[-1][1]}
        if password is not None:
            payload["password"] = password
        assert client.post("/auth/login", json=payload).status_code == 422
        payload["password"] = "valid-password"
        assert client.post("/auth/login", json=payload).status_code == 200


def test_phone_login_creates_user_cookie_and_logout_revokes_it(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        assert client.get("/protected").status_code == 401
        with app.state.auth_store.connect() as db:
            assert db.execute("SELECT DATABASE() AS name").fetchone()["name"] == app.state.settings.mysql_database
        response = login(client, sent)
        assert response.status_code == 200
        assert response.json()["user"]["role"] == "user"
        assert "token" not in response.json()
        assert "httponly" in response.headers["set-cookie"].lower()
        cookie = client.cookies.get("opentalking_session")
        assert client.get("/auth/me").json()["user"]["phone"] == "13800138000"
        assert client.get("/protected").status_code == 200
        assert client.post("/auth/logout").status_code == 200
        client.cookies.set("opentalking_session", cookie)
        assert client.get("/protected").status_code == 401


def test_code_is_not_disclosed_and_cannot_be_reused(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        response = client.post("/auth/sms", json={"phone": "+8613800138000"})
        assert response.status_code == 200
        code = sent[-1][1]
        assert len(code) == 6 and code.isdigit()
        assert code not in response.text
        payload = {"phone": "13800138000", "code": code, "password": "test-password", "role": "admin"}
        assert client.post("/auth/login", json=payload).status_code == 422
        payload.pop("role")
        first = client.post("/auth/login", json=payload)
        assert first.json()["user"]["role"] == "user"
        assert client.post("/auth/login", json=payload).status_code == 400


def test_send_cooldown_and_five_bad_attempts_invalidate_code(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        assert client.post("/auth/sms", json={"phone": "13800138000"}).status_code == 200
        assert client.post("/auth/sms", json={"phone": "13800138000"}).status_code == 429
        correct = sent[-1][1]
        wrong = "000000" if correct != "000000" else "111111"
        for _ in range(5):
            assert client.post("/auth/login", json={"phone": "13800138000", "code": wrong, "password": "test-password"}).status_code == 400
        assert client.post("/auth/login", json={"phone": "13800138000", "code": correct, "password": "test-password"}).status_code == 400


def test_expired_code_cannot_login(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        client.post("/auth/sms", json={"phone": "13800138000"})
        with app.state.auth_store.connect() as db:
            db.execute("UPDATE auth_codes SET expires_at = 0")
        assert client.post("/auth/login", json={"phone": "13800138000", "code": sent[-1][1], "password": "test-password"}).status_code == 400


def test_failed_send_never_activates_a_code(auth_app, monkeypatch):
    from apps.api.modules.auth import sms
    app, sent = auth_app

    async def fail(settings, phone, code):
        sent.append((phone, code))
        raise sms.SmsError("发送失败")

    monkeypatch.setattr(sms, "send_sms", fail)
    with TestClient(app) as client:
        assert client.post("/auth/sms", json={"phone": "13800138000"}).status_code == 502
        assert client.post("/auth/login", json={"phone": "13800138000", "code": sent[-1][1], "password": "test-password"}).status_code == 400


@pytest.mark.parametrize("accepted", [True, False])
def test_spug_provider_activates_only_accepted_codes_and_preserves_admin(auth_app, monkeypatch, accepted):
    import json
    import httpx
    from apps.api.modules.auth import sms
    app, _ = auth_app
    app.state.settings.sms_provider = "spug"
    app.state.settings.spug_sms_template_code = "integration-template"
    app.state.settings.tencent_sms_secret_id = ""
    monkeypatch.setattr(sms, "send_sms", app.state.provider_send_sms)
    sent = []
    real_client = httpx.AsyncClient

    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"code": 200 if accepted else 400,
                                        "request_id": "integration-request"})

    monkeypatch.setattr(sms.httpx, "AsyncClient", lambda **kw: real_client(
        transport=httpx.MockTransport(handle), **kw))
    with TestClient(app) as client:
        assert client.get("/auth/status").json() == {"enabled": True, "sms_ready": True, 'billing_enabled': False}
        assert client.post("/auth/admin/login", json={"username": "operator", "password": "correct-password-123"}).status_code == 200
        response = client.post("/auth/sms", json={"phone": "+8613800138000"})
        assert response.status_code == (200 if accepted else 502)
        assert len(sent) == 1
        assert sent[0]["to"] == "13800138000"
        assert sent[0]["number"] == "5"
        credentials = {"phone": "13800138000", "code": sent[0]["code"], "password": "test-password"}
        result = client.post("/auth/login", json=credentials)
        assert result.status_code == (200 if accepted else 400)
        if accepted:
            assert result.json()["user"]["role"] == "user"
            assert client.get("/auth/me").status_code == 200
            assert client.post("/auth/login", json=credentials).status_code == 400
        assert client.get("/admin/overview").status_code == 200


def test_spug_missing_template_disables_sms_even_with_tencent_credentials(auth_app):
    app, sent = auth_app
    app.state.settings.sms_provider = "spug"
    app.state.settings.spug_sms_template_code = ""
    with TestClient(app) as client:
        assert client.get("/auth/status").json()["sms_ready"] is False
        assert client.post("/auth/sms", json={"phone": "13800138000"}).status_code == 503
        assert not sent


def test_user_cannot_enter_admin_or_edit_global_configuration(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        login(client, sent)
        assert client.get("/admin/overview").status_code == 401
        assert client.post("/runtime-config/apply").status_code == 403
        assert client.post("/auth/admin/register", json={}).status_code == 401


def test_preconfigured_admin_login_and_revenue_is_pending(auth_app):
    app, _ = auth_app
    with TestClient(app) as client:
        assert client.post("/auth/admin/login", json={"username": "operator", "password": "incorrect"}).status_code == 401
        response = client.post("/auth/admin/login", json={"username": "operator", "password": "correct-password-123"})
        assert response.status_code == 200
        assert response.json()["user"]["role"] == "admin"
        result = client.get("/admin/overview")
        assert result.status_code == 200
        assert result.json()["revenue"] == {"status": "not_connected", "amount_fen": None, "currency": "CNY"}
        assert client.post("/runtime-config/apply", headers={"X-Opentalking-Portal": "admin"}).status_code == 200
        assert client.post("/auth/admin/register", json={}).status_code == 404


def test_password_user_can_login_without_sms_and_cannot_manage_settings(auth_app):
    app, sent = auth_app
    create_phone_user(app.state.auth_store, password="test-password-123")
    app.state.settings.tencent_sms_secret_id = ""
    with TestClient(app) as client:
        credentials = {"phone": "13800138000", "password": "test-password-123"}
        assert client.post("/auth/password/login", json={**credentials, "password": "wrong"}).status_code == 401
        response = client.post("/auth/password/login", json=credentials)
        assert response.status_code == 200
        assert response.json()["user"]["role"] == "user"
        assert response.json()["user"]["phone"] == "13800138000"
        assert "httponly" in response.headers["set-cookie"].lower()
        assert client.get("/protected").status_code == 200
        assert client.get("/admin/overview").status_code == 401
        assert client.post("/runtime-config/apply").status_code == 403
        assert not sent
        assert client.post("/auth/admin/login", json=credentials).status_code == 422
        assert client.post("/auth/logout").status_code == 200
        assert client.get("/protected").status_code == 401


def test_password_login_rejects_legacy_usernames_and_rate_limits_bad_attempts(auth_app):
    app, _ = auth_app
    with TestClient(app) as client:
        assert client.post("/auth/password/login", json={"username": "operator", "password": "correct-password-123"}).status_code == 422
        for _ in range(10):
            assert client.post("/auth/password/login", json={"phone": "13800138000", "password": "wrong"}).status_code == 401
        assert client.post("/auth/password/login", json={"phone": "13800138000", "password": "wrong"}).status_code == 429


def test_legacy_test_username_cannot_authenticate(auth_app):
    from apps.api.modules.auth.store import password_hash
    app, _ = auth_app
    with app.state.auth_store.connect() as db:
        db.execute("INSERT INTO auth_users(role, username, password_hash) VALUES('user', %s, %s)",
                   ("test", password_hash("123456")))
    with TestClient(app) as client:
        assert client.post("/auth/password/login", json={"username": "test", "password": "123456"}).status_code == 422
        assert client.post("/auth/password/login", json={"phone": "13800138000", "password": "123456"}).status_code == 401
        assert client.get("/auth/me").status_code == 401


@pytest.mark.parametrize("admin_first", [True, False])
def test_user_and_admin_sessions_coexist_in_one_browser(auth_app, admin_first):
    app, _ = auth_app
    create_phone_user(app.state.auth_store)
    with TestClient(app) as client:
        signins = [
            ("/auth/admin/login", {"username": "operator", "password": "correct-password-123"}),
            ("/auth/password/login", {"phone": "13800138000", "password": "test-password"}),
        ]
        for path, credentials in signins if admin_first else reversed(signins):
            assert client.post(path, json=credentials).status_code == 200
        assert client.get("/auth/me").json()["user"]["phone"] == "13800138000"
        admin_headers = {"X-Opentalking-Portal": "admin"}
        admin_me = client.get("/auth/me", headers=admin_headers)
        assert admin_me.json()["user"]["role"] == "admin"
        assert client.get("/admin/overview", headers=admin_headers).status_code == 200
        assert client.get("/protected").status_code == 200
        assert client.post("/runtime-config/apply").status_code == 403
        assert client.post("/runtime-config/apply", headers=admin_headers).status_code == 200


@pytest.mark.parametrize("logout_portal", ["user", "admin"])
def test_logging_out_of_one_portal_preserves_the_other(auth_app, logout_portal):
    app, _ = auth_app
    create_phone_user(app.state.auth_store)
    with TestClient(app) as client:
        client.post("/auth/admin/login", json={"username": "operator", "password": "correct-password-123"})
        client.post("/auth/password/login", json={"phone": "13800138000", "password": "test-password"})
        headers = {"X-Opentalking-Portal": logout_portal}
        assert client.post("/auth/logout", headers=headers).status_code == 200
        assert client.get("/auth/me", headers=headers).status_code == 401
        other = "admin" if logout_portal == "user" else "user"
        response = client.get("/auth/me", headers={"X-Opentalking-Portal": other})
        assert response.status_code == 200
        assert response.json()["user"]["role"] == other


def test_user_cookie_is_never_accepted_as_an_admin_session(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        login(client, sent)
        user_token = client.cookies.get("opentalking_session")
        client.cookies.set("opentalking_admin_session", user_token)
        assert client.get("/auth/me", headers={"X-Opentalking-Portal": "admin"}).status_code == 401
        assert client.get("/admin/overview").status_code == 401
        assert client.get("/auth/me").json()["user"]["role"] == "user"


def test_six_character_admin_password_reset_revokes_old_session(auth_app):
    app, _ = auth_app
    with TestClient(app) as client:
        credentials = {"username": "operator", "password": "correct-password-123"}
        assert client.post("/auth/admin/login", json=credentials).status_code == 200
        admin_headers = {"X-Opentalking-Portal": "admin"}
        assert client.get("/auth/me", headers=admin_headers).status_code == 200
        app.state.auth_store.provision_admin("operator", "123456", replace=True)
        assert client.get("/auth/me", headers=admin_headers).status_code == 401
        assert client.post("/auth/admin/login", json=credentials).status_code == 401
        credentials["password"] = "123456"
        assert client.post("/auth/admin/login", json=credentials).status_code == 200


def test_cross_origin_mutations_are_rejected(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        login(client, sent)
        assert client.post("/auth/logout", headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.get("/auth/me").status_code == 200


def test_old_tab_cannot_write_using_a_different_accounts_cookie(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        result = login(client, sent)
        current_id = result.json()["user"]["id"]
        assert client.get("/protected", headers={"X-Opentalking-Account": str(current_id + 1)}).status_code == 401
        assert client.get("/protected", headers={"X-Opentalking-Account": str(current_id)}).status_code == 200


@pytest.mark.parametrize("username,password", [("operator", "x" * 129), ("x" * 81, "valid-password-123"), ("  ", "valid-password-123")])
def test_admin_provision_rejects_credentials_the_login_api_cannot_accept(auth_app, username, password):
    app, _ = auth_app
    with pytest.raises(ValueError):
        app.state.auth_store.provision_admin(username, password)


def test_invalid_phone_is_rejected_before_sending(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        for phone in ["", "123", "../13800138000", "+113800138000"]:
            assert client.post("/auth/sms", json={"phone": phone}).status_code == 422
        assert not sent


def test_same_origin_browser_requests_work_and_private_responses_are_not_cached(auth_app):
    app, sent = auth_app
    with TestClient(app, headers={"Origin": "http://testserver"}) as client:
        assert login(client, sent).status_code == 200
        assert client.get("/auth/me").headers["cache-control"] == "no-store"


def test_concurrent_login_consumes_code_only_once(auth_app):
    from concurrent.futures import ThreadPoolExecutor
    from apps.api.modules.auth.store import AuthError
    app, sent = auth_app
    with TestClient(app) as client:
        client.post("/auth/sms", json={"phone": "13800138000"})
        code = sent[-1][1]

        def attempt():
            try:
                app.state.auth_store.phone_login("13800138000", code, 24, "test-password")
                return True
            except AuthError:
                return False

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: attempt(), range(2)))
        assert sorted(results) == [False, True]


def test_global_sms_limit_stops_new_numbers(auth_app):
    app, sent = auth_app
    app.state.settings.sms_daily_limit = 1
    with TestClient(app) as client:
        assert client.post("/auth/sms", json={"phone": "13800138000"}).status_code == 200
        assert client.post("/auth/sms", json={"phone": "13900139000"}).status_code == 429
        assert len(sent) == 1


def test_expired_session_is_rejected(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        login(client, sent)
        with app.state.auth_store.connect() as db:
            db.execute("UPDATE auth_sessions SET expires_at=0")
        assert client.get("/protected").status_code == 401


def test_missing_mysql_configuration_returns_service_error_without_exposing_secrets(auth_app):
    app, _ = auth_app
    app.state.settings.mysql_user = ""
    with TestClient(app) as client:
        assert client.get("/auth/status").status_code == 200
        response = client.post("/auth/admin/login", json={"username": "operator", "password": "incorrect"})
        assert response.status_code == 503
        assert "correct-password-123" not in response.text


def test_exports_are_private_including_download_and_delete(auth_app):
    from apps.api.modules.works import router as works
    app, sent = auth_app
    app.include_router(works.router)
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, sent)
        response = alice.post("/exports/videos", data={"kind": "video_creation", "title": "private"},
                              files={"file": ("clip.webm", b"alice-video", "video/webm")})
        assert response.status_code == 200
        item = response.json()
        login(bob, sent, "13900139000")
        assert bob.get("/exports/videos").json() == {"items": []}
        for suffix in ["", "/download"]:
            assert bob.get(f"/exports/videos/{item['id']}{suffix}").status_code == 404
        assert bob.delete(f"/exports/videos/{item['id']}").status_code == 404
        assert alice.get(f"/exports/videos/{item['id']}/download").content == b"alice-video"


def test_session_events_controls_and_websockets_check_owner(auth_app):
    from opentalking.core.in_memory_redis import InMemoryRedis
    from starlette.websockets import WebSocketDisconnect
    app, sent = auth_app
    app.state.redis = InMemoryRedis()

    @app.get("/sessions/private/events")
    def events():
        return {"owner_only": True}

    @app.websocket("/sessions/private/speak_audio_stream")
    async def stream(ws: WebSocket):
        await ws.accept()
        await ws.send_json({"owner_only": True})
        await ws.close()

    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, sent)
        user_id = alice.get("/auth/me").json()["user"]["id"]
        alice.portal.call(app.state.redis.hset, "opentalking:session:private", "user_id", str(user_id))
        assert alice.get("/sessions/private/events").status_code == 200
        login(bob, sent, "13900139000")
        assert bob.get("/sessions/private/events").status_code == 404
        with pytest.raises(WebSocketDisconnect):
            with bob.websocket_connect("/sessions/private/speak_audio_stream"):
                pass
        with alice.websocket_connect("/sessions/private/speak_audio_stream") as ws:
            assert ws.receive_json() == {"owner_only": True}
