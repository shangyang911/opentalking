# ruff: noqa: F811
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.api.test_auth import auth_app, create_phone_user, login  # noqa: F401
from backend.tests.api.test_billing import billing, enable_plan  # noqa: F401


def test_profile_defaults_update_persistence_and_account_isolation(auth_app):
    app, sent = auth_app
    with TestClient(app) as first, TestClient(app) as second:
        assert login(first, sent).status_code == 200
        assert login(second, sent, '13900139000').status_code == 200
        initial = first.get('/account/profile')
        assert initial.status_code == 200
        assert initial.json()['nickname'] == ''
        assert initial.json()['avatar_url'] is None
        saved = first.put('/account/profile', json={'nickname': ' 小林 ', 'signature': ' 做自己的数字创作者 '})
        assert saved.status_code == 200
        assert saved.json()['nickname'] == '小林'
        assert first.get('/account/profile').json()['signature'] == '做自己的数字创作者'
        assert second.get('/account/profile').json()['nickname'] == ''
        assert first.put('/account/profile', json={'nickname': 'x', 'signature': '', 'user_id': 3}).status_code == 422
        assert first.get('/account/profile', headers={'X-Opentalking-Account': '99999'}).status_code == 401


@pytest.mark.parametrize('payload', [
    {'nickname': 'x' * 31, 'signature': ''},
    {'nickname': '', 'signature': 'x' * 121},
    {'nickname': 'hello\x00', 'signature': ''},
])
def test_profile_rejects_invalid_text(auth_app, payload):
    app, sent = auth_app
    with TestClient(app) as client:
        login(client, sent)
        assert client.put('/account/profile', json=payload).status_code == 422


def test_avatar_is_reencoded_private_and_removable(auth_app):
    app, sent = auth_app
    picture = BytesIO()
    Image.new('RGB', (500, 300), 'purple').save(picture, format='PNG')
    with TestClient(app) as client, TestClient(app) as other:
        login(client, sent)
        login(other, sent, '13900139000')
        uploaded = client.post('/account/avatar', files={'file': ('avatar.png', picture.getvalue(), 'image/png')})
        assert uploaded.status_code == 200, uploaded.text
        assert uploaded.json()['avatar_url'].startswith('/account/avatar?v=')
        response = client.get(uploaded.json()['avatar_url'])
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        assert response.headers['content-type'] == 'image/webp'
        image = Image.open(BytesIO(response.content))
        assert image.size == (256, 256)
        assert not image.getexif()
        assert other.get('/account/avatar').status_code == 404
        assert client.delete('/account/avatar').status_code == 200
        assert client.get('/account/profile').json()['avatar_url'] is None
        assert client.get('/account/avatar').status_code == 404


@pytest.mark.parametrize('data,expected', [(b'<svg/>', 400), (b'bad image', 400), (b'x' * (2 * 1024 * 1024 + 1), 413)])
def test_avatar_rejects_invalid_uploads(auth_app, data, expected):
    app, sent = auth_app
    with TestClient(app) as client:
        login(client, sent)
        assert client.post('/account/avatar', files={'file': ('image.png', data, 'image/png')}).status_code == expected


def test_avatar_rejects_excessive_decoded_dimensions(auth_app):
    app, sent = auth_app
    picture = BytesIO()
    Image.new('1', (4001, 4000)).save(picture, format='PNG')
    with TestClient(app) as client:
        login(client, sent)
        assert client.post('/account/avatar', files={'file': ('large.png', picture.getvalue(), 'image/png')}).status_code == 400


def test_password_change_preserves_current_session_revokes_others(auth_app):
    app, sent = auth_app
    with TestClient(app) as client, TestClient(app) as other:
        login(client, sent)
        other.post('/auth/password/login', json={'phone': '13800138000', 'password': 'test-password'})
        assert client.post('/account/password', json={'current_password': 'wrong', 'new_password': 'new-password'}).status_code == 400
        assert client.get('/auth/me').status_code == 200
        assert client.post('/account/password', json={'current_password': 'test-password', 'new_password': 'new-password'}).status_code == 200
        assert client.get('/auth/me').status_code == 200
        assert other.get('/auth/me').status_code == 401
        assert other.post('/auth/password/login', json={'phone': '13800138000', 'password': 'test-password'}).status_code == 401
        assert other.post('/auth/password/login', json={'phone': '13800138000', 'password': 'new-password'}).status_code == 200


def test_password_failures_are_rate_limited(auth_app):
    app, sent = auth_app
    with TestClient(app) as client:
        login(client, sent)
        for _ in range(5):
            assert client.post('/account/password', json={'current_password': 'wrong', 'new_password': 'new-password'}).status_code == 400
        assert client.post('/account/password', json={'current_password': 'wrong', 'new_password': 'new-password'}).status_code == 429


def test_inflight_old_password_login_is_revoked_by_password_change(auth_app, monkeypatch):
    from apps.api.modules.auth import store as auth_store
    app, sent = auth_app
    entered, release = Event(), Event()
    original_check = auth_store.check_password

    def delayed_check(password, encoded):
        if password == 'test-password':
            entered.set()
            assert release.wait(5)
        return original_check(password, encoded)

    with TestClient(app) as client:
        login(client, sent)
        monkeypatch.setattr(auth_store, 'check_password', delayed_check)
        with ThreadPoolExecutor(2) as pool:
            signing_in = pool.submit(app.state.auth_store.user_login, '13800138000', 'test-password', 'concurrent', 24)
            assert entered.wait(5)
            changing = pool.submit(client.post, '/account/password', json={'current_password': 'test-password', 'new_password': 'new-password'})
            try:
                changing.result(timeout=.3)
            except TimeoutError:
                pass
            finally:
                release.set()
            _, token = signing_in.result(timeout=5)
            assert changing.result(timeout=5).status_code == 200
        assert app.state.auth_store.resolve(token) is None


def test_profile_requires_user_session(auth_app):
    app, _ = auth_app
    with TestClient(app) as client:
        assert client.get('/account/profile').status_code == 401
        client.post('/auth/admin/login', json={'username': 'operator', 'password': 'correct-password-123'})
        assert client.get('/account/profile', headers={'X-Opentalking-Portal': 'admin'}).status_code == 403


def test_account_lists_grant_sources_and_own_settled_activity(billing):
    store, client, uid, app = billing
    store.gift(uid, 1, 60, 30, 7, 'test gift', 'account-gift')
    grants = client.get('/billing/me').json()['grants']
    assert {item['kind'] for item in grants} == {'free', 'gift'}
    assert all(item['expires_at'] > 0 for item in grants)
    store.reserve(uid, 'account-test-task', 'conversation', 'mock')
    store.start('account-test-task')
    store.finish('account-test-task', 12)
    activity = client.get('/billing/activity')
    assert activity.status_code == 200
    task = activity.json()['activity'][0]
    assert task['used_seconds'] == 12 and task['state'] == 'finished'
    assert 'allocations' not in task and 'user_id' not in task
    _, token = create_phone_user(app.state.auth_store, '13900139000')
    from apps.api.modules.auth.session import USER_COOKIE
    with TestClient(app) as other:
        other.cookies.set(USER_COOKIE, token)
        assert other.get('/billing/activity').json()['activity'] == []


def test_new_vip_plan_edits_require_thirty_days_without_changing_old_orders(billing):
    store, _, uid, _ = billing
    enable_plan(store)
    order = store.create_order(uid, 'vip', 'account-monthly')
    plan = dict(order['plan'], valid_days=31)
    with pytest.raises(Exception, match='30'):
        store.save_plan('vip', plan)
    assert store.orders(uid)[0]['plan']['valid_days'] == 30


def test_activity_identifies_preview_and_clone_actions(billing):
    store, client, uid, app = billing
    store.gift(uid, 1, 120, 0, 7, 'test gift', 'voice-actions')

    @app.post('/tts/preview')
    def preview():
        return {'ok': True}

    @app.post('/voices/clone')
    def clone():
        return {'ok': True}

    assert client.post('/tts/preview').status_code == 200
    assert client.post('/voices/clone').status_code == 200
    assert {row['kind'] for row in client.get('/billing/activity').json()['activity']} == {'preview', 'clone'}
