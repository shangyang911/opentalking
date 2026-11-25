from __future__ import annotations

# pytest injects the imported billing fixture into same-named test parameters.
# ruff: noqa: F811

import pytest
from fastapi.testclient import TestClient

from backend.tests.api.test_billing import auth_app, billing, enable_plan  # noqa: F401
from backend.tests.api.test_auth import login
from apps.api.modules.auth.store import AuthError


def admin_login(client):
    response = client.post('/auth/admin/login', json={
        'username': 'operator', 'password': 'correct-password-123',
    })
    assert response.status_code == 200


def demo_order(store, uid, request_id='demo-1'):
    store.settings.billing_demo_enabled = True
    return store.create_order(uid, 'vip', request_id)


def test_demo_payment_waits_for_admin_then_grants_real_metered_entitlements(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    order = demo_order(store, uid)
    oid = order['id']
    assert order['plan']['payment_mode'] == 'demo'
    assert client.get('/billing/plans').json()['payment_mode'] == 'demo'
    assert client.post(f'/admin/billing/orders/{oid}/demo-confirm').status_code in (401, 403)
    admin_login(client)
    assert client.post(f'/admin/billing/orders/{oid}/demo-confirm').status_code == 409
    for _ in range(2):
        response = client.post(f'/billing/orders/{oid}/demo-pay')
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'demo_submitted'
    assert not client.get('/billing/me').json()['vip']
    for _ in range(2):
        response = client.post(f'/admin/billing/orders/{oid}/demo-confirm')
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'paid'
    account = client.get('/billing/me').json()
    assert account['vip'] and account['quicktalk_seconds'] == 600
    assert store.overview()['paid_fen'] == 0
    assert store.overview()['paying_users'] == 0
    store.reserve(uid, 'demo_session', 'conversation', 'quicktalk')
    store.start('demo_session')
    store.finish('demo_session', 7)
    assert store.account(uid)['quicktalk_seconds'] == 593


def test_demo_endpoints_are_disabled_by_default_and_reject_manual_orders(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    order = store.create_order(uid, 'vip', 'manual')
    assert client.get('/billing/plans').json()['payment_mode'] == 'manual'
    admin_login(client)
    for action, prefix in [('demo-pay', '/billing'), ('demo-confirm', '/admin/billing'), ('demo-revoke', '/admin/billing')]:
        assert client.post(f'{prefix}/orders/{order["id"]}/{action}').status_code == 409
    store.settings.billing_demo_enabled = True
    assert client.post(f'/billing/orders/{order["id"]}/demo-pay').status_code == 409
    assert client.post(f'/admin/billing/orders/{order["id"]}/demo-confirm').status_code == 409
    assert client.post(f'/admin/billing/orders/{order["id"]}/confirm', json={'receipt': 'real-1'}).status_code == 200
    assert store.overview()['paid_fen'] == 100


def test_other_accounts_cannot_submit_or_cancel_demo_orders(billing):
    store, client, uid, app = billing
    enable_plan(store)
    order = demo_order(store, uid)
    with TestClient(app) as other:
        assert login(other, app.state.test_sent, phone='13900139000').status_code == 200
        assert other.post(f'/billing/orders/{order["id"]}/demo-pay').status_code == 404
        assert other.post(f'/billing/orders/{order["id"]}/cancel').status_code == 404
    assert client.post(f'/billing/orders/{order["id"]}/demo-pay').status_code == 200
    assert client.post(f'/billing/orders/{order["id"]}/cancel').status_code == 200
    assert not store.account(uid)['vip']


def test_demo_cannot_be_approved_or_refunded_through_real_payment_endpoints(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    order = demo_order(store, uid)
    admin_login(client)
    assert client.post(f'/admin/billing/orders/{order["id"]}/confirm', json={'receipt': 'fake-real'}).status_code == 409
    client.post(f'/billing/orders/{order["id"]}/demo-pay')
    client.post(f'/admin/billing/orders/{order["id"]}/demo-confirm')
    assert client.post(f'/admin/billing/orders/{order["id"]}/refund', json={'receipt': 'fake-refund'}).status_code == 409
    assert store.overview()['amount_fen'] == 0


def test_disabling_demo_hides_fake_vip_and_prevents_new_allocations(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    store.settings.billing_trial_count = 0
    with store.connect() as db:
        db.execute('UPDATE billing_accounts SET trials_remaining=0 WHERE user_id=%s', (uid,))
    order = demo_order(store, uid)
    client.post(f'/billing/orders/{order["id"]}/demo-pay')
    admin_login(client)
    client.post(f'/admin/billing/orders/{order["id"]}/demo-confirm')
    assert store.account(uid)['vip']
    store.settings.billing_demo_enabled = False
    assert not store.account(uid)['vip']
    assert store.account(uid)['quicktalk_seconds'] == 0
    assert store.account(uid)['video_seconds'] == 0
    for kind in ['conversation', 'video']:
        with pytest.raises(AuthError) as error:
            store.reserve(uid, f'blocked_{kind}', kind, 'quicktalk')
        assert error.value.status == 402
    assert client.post(f'/admin/billing/orders/{order["id"]}/demo-confirm').status_code == 409


def test_demo_revocation_and_real_renewals_keep_separate_expiry_and_revenue(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    real = store.create_order(uid, 'vip', 'real')
    store.confirm(real['id'], 1, 'real-bank')
    real_until = store.account(uid)['vip_until']
    fake = demo_order(store, uid)
    client.post(f'/billing/orders/{fake["id"]}/demo-pay')
    admin_login(client)
    client.post(f'/admin/billing/orders/{fake["id"]}/demo-confirm')
    assert store.account(uid)['vip_until'] < real_until + 5
    assert store.account(uid)['quicktalk_seconds'] == 1200
    for _ in range(2):
        assert client.post(f'/admin/billing/orders/{fake["id"]}/demo-revoke').status_code == 200
    assert store.account(uid)['vip_until'] == real_until
    assert store.account(uid)['quicktalk_seconds'] == 600
    assert store.overview()['paid_fen'] == 100
    assert store.overview()['refund_fen'] == 0


def test_submitted_demo_orders_count_towards_pending_limit_and_request_ids_keep_mode(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    for index in range(5):
        order = demo_order(store, uid, f'demo-{index}')
        assert client.post(f'/billing/orders/{order["id"]}/demo-pay').status_code == 200
    with pytest.raises(AuthError) as error:
        demo_order(store, uid, 'over-limit')
    assert error.value.status == 409
    store.settings.billing_demo_enabled = False
    with pytest.raises(AuthError) as error:
        store.create_order(uid, 'vip', 'demo-0')
    assert error.value.status == 409


def test_disabling_demo_blocks_starting_an_already_reserved_video(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    order = demo_order(store, uid)
    client.post(f'/billing/orders/{order["id"]}/demo-pay')
    admin_login(client)
    client.post(f'/admin/billing/orders/{order["id"]}/demo-confirm')
    store.reserve(uid, 'reserved_demo_video', 'video', 'quicktalk')
    store.settings.billing_demo_enabled = False
    with pytest.raises(AuthError) as error:
        store.start('reserved_demo_video')
    assert error.value.status == 402
    store.finish('reserved_demo_video', 0)


def test_real_vip_can_receive_a_demo_pack_without_a_demo_vip(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    enable_plan(store, 'pack')
    real = store.create_order(uid, 'vip', 'real-vip')
    store.confirm(real['id'], 1, 'real-vip-bank')
    expiry = store.account(uid)['vip_until']
    store.settings.billing_demo_enabled = True
    order = store.create_order(uid, 'pack', 'demo-pack')
    client.post(f'/billing/orders/{order["id"]}/demo-pay')
    admin_login(client)
    response = client.post(f'/admin/billing/orders/{order["id"]}/demo-confirm')
    assert response.status_code == 200, response.text
    account = store.account(uid)
    assert account['quicktalk_seconds'] == 1200
    assert all(g['expires_at'] <= expiry for g in account['grants'] if g['kind'] == 'pack')
    vip = demo_order(store, uid, 'demo-vip')
    client.post(f'/billing/orders/{vip["id"]}/demo-pay')
    client.post(f'/admin/billing/orders/{vip["id"]}/demo-confirm')
    client.post(f'/admin/billing/orders/{vip["id"]}/demo-revoke')
    assert store.account(uid)['quicktalk_seconds'] == 1200
    store.settings.billing_demo_enabled = False
    assert store.account(uid)['quicktalk_seconds'] == 600
