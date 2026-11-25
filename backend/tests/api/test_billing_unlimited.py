from __future__ import annotations

# pytest fixture injection uses the imported fixture name as a parameter.
# ruff: noqa: F811
import time

import pytest

from apps.api.modules.auth.store import AuthError
from backend.tests.api.test_billing import auth_app, billing, enable_plan  # noqa: F401
from backend.tests.api.test_billing_demo import admin_login


def publish_monthly(client):
    admin_login(client)
    response = client.put('/admin/billing/plans/vip', json={
        'name': '月度 VIP', 'kind': 'vip', 'price_fen': 10000,
        'conversation_seconds': 0, 'video_seconds': 0, 'max_session_seconds': 3600,
        'valid_days': 30, 'active': True, 'unlimited': True,
    })
    assert response.status_code == 200, response.text
    return response.json()


def activate(store, client, uid, *, demo=False):
    store.settings.billing_demo_enabled = demo
    publish_monthly(client)
    order = store.create_order(uid, 'vip', 'monthly')
    if demo:
        assert client.post(f'/billing/orders/{order["id"]}/demo-pay').status_code == 200
        response = client.post(f'/admin/billing/orders/{order["id"]}/demo-confirm')
        assert response.status_code == 200, response.text
    else:
        store.confirm(order['id'], 1, 'monthly-bank')
    return order


def test_monthly_vip_allows_repeated_tasks_without_a_total_time_balance(billing):
    store, client, uid, _ = billing
    order = activate(store, client, uid)
    assert order['amount_fen'] == 10000 and order['plan']['unlimited']
    before = store.account(uid)
    assert before['unlimited'] and before['unlimited_until'] == before['vip_until']
    assert before['video_seconds'] == 0 and before['quicktalk_seconds'] == 0
    for index, kind in enumerate(['conversation', 'video', 'conversation', 'video']):
        rid = f'monthly_{index}'
        reservation = store.reserve(uid, rid, kind, 'quicktalk')
        assert reservation['seconds'] == (3600 if kind == 'conversation' else 60)
        store.start(rid)
        store.finish(rid, 30)
        assert store.account(uid)['unlimited']
    after = store.account(uid)
    assert after['conversation_seconds'] == before['conversation_seconds']
    assert after['trials_remaining'] == before['trials_remaining']
    assert all(task['unlimited'] for task in store.activity(uid))


def test_unlimited_auxiliary_reservations_keep_their_per_request_limit(billing):
    store, client, uid, _ = billing
    activate(store, client, uid)
    store.limit_action(uid, 'clone')
    row = store.reserve(uid, 'monthly_clone', 'conversation', 'mock', 60)
    assert row['seconds'] == 60
    store.start('monthly_clone')
    store.finish('monthly_clone', 60)
    assert store.account(uid)['unlimited']
    assert store.account(uid)['conversation_seconds'] == 180


def test_unlimited_entitlement_expiry_and_refund_remove_unlimited_access(billing):
    store, client, uid, _ = billing
    order = activate(store, client, uid)
    store.refund(order['id'], 1, 'monthly-refund')
    assert not store.account(uid)['unlimited']
    with pytest.raises(AuthError) as error:
        store.reserve(uid, 'after_refund', 'video', 'quicktalk')
    assert error.value.status == 402
    second = store.create_order(uid, 'vip', 'monthly-second')
    store.confirm(second['id'], 1, 'monthly-bank-second')
    with store.connect() as db:
        db.execute("UPDATE billing_grants SET expires_at=%s WHERE source_id=%s", (time.time()-1, second['id']))
    assert not store.account(uid)['unlimited']
    assert store.account(uid)['unlimited_until'] is None


def test_unlimited_task_deadline_cannot_outlive_vip_expiry(billing):
    store, client, uid, _ = billing
    order = activate(store, client, uid)
    expiry = time.time() + 10
    with store.connect() as db:
        db.execute('UPDATE billing_grants SET expires_at=%s WHERE source_id=%s', (expiry, order['id']))
    row = store.reserve(uid, 'near_expiry', 'conversation', 'quicktalk')
    assert 0 < row['seconds'] <= 10
    assert store.start('near_expiry')['expires_at'] <= expiry
    store.finish('near_expiry', 0)


def test_demo_unlimited_vip_is_not_a_formal_entitlement_when_demo_is_off(billing):
    store, client, uid, _ = billing
    activate(store, client, uid, demo=True)
    assert store.account(uid)['unlimited']
    store.reserve(uid, 'demo_unlimited_reserved', 'video', 'quicktalk')
    store.settings.billing_demo_enabled = False
    assert not store.account(uid)['unlimited']
    with pytest.raises(AuthError):
        store.start('demo_unlimited_reserved')
    store.finish('demo_unlimited_reserved', 0)
    assert store.overview()['paid_fen'] == 0


def test_publishing_unlimited_does_not_silently_rewrite_previous_order_snapshots(billing):
    store, client, uid, _ = billing
    enable_plan(store)
    old = store.create_order(uid, 'vip', 'previous')
    store.confirm(old['id'], 1, 'previous-bank')
    publish_monthly(client)
    account = store.account(uid)
    assert account['vip'] and not account['unlimited']
    assert account['quicktalk_seconds'] == 600


def test_unlimited_is_only_valid_for_the_monthly_vip_plan(billing):
    _, client, _, _ = billing
    plan = publish_monthly(client)
    plan.pop('id')
    plan['kind'] = 'pack'
    assert client.put('/admin/billing/plans/pack', json=plan).status_code == 422
