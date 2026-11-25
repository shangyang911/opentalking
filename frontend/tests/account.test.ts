import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accountDisplayName, profileAvatarSrc, type Profile } from '../src/features/account/api';
import { activityDescription, grantLabel, type Activity } from '../src/features/billing/api';
import { MembershipContent } from '../src/features/billing/MembershipDialog';
import { TopBar } from '../src/app/TopBar';

const user = { id: 2, role: 'user' as const, phone: '13800138000', username: null };
const profile: Profile = { id: 2, phone: user.phone, nickname: '小林', signature: '', created_at: 1, avatar_url: null };

test('account name uses saved nickname and falls back to a masked phone', () => {
  assert.equal(accountDisplayName(user, profile), '小林');
  assert.match(accountDisplayName(user, null), /138.*8000/);
  assert.ok(!accountDisplayName(user, null).includes('13800138000'));
});

test('profile avatars only accept the private account avatar endpoint', () => {
  assert.equal(profileAvatarSrc('https://evil.test/x'), undefined);
  assert.equal(profileAvatarSrc('/avatars/office-woman/preview'), undefined);
  assert.equal(profileAvatarSrc('//evil.test/x'), undefined);
  assert.match(profileAvatarSrc('/account/avatar?v=123')!, /\/api\/account\/avatar\?v=123$/);
});

test('settlement labels distinguish trial use, initialization return and reserved time', () => {
  const task: Activity = { id: 'test', kind: 'conversation', model: 'quicktalk', seconds: 60, trial: true, state: 'finished', created_at: 1, started_at: 1, used_seconds: 12 };
  assert.match(activityDescription(task), /1 次体验/);
  assert.match(activityDescription({ ...task, started_at: 0, used_seconds: 0 }), /已退回/);
  assert.match(activityDescription({ ...task, trial: false, state: 'reserved' }), /预留/);
  assert.equal(grantLabel('free'), '免费轻量额度');
});

test('personal account entry remains visible on small screens and shows the saved avatar', () => {
  const html = renderToStaticMarkup(createElement(TopBar, { connection: 'idle', accountLabel: '小林', accountAvatar: '/api/account/avatar?v=1', onAccount: () => undefined }));
  assert.match(html, /aria-label="打开个人中心"/);
  assert.match(html, /<img[^>]+account\/avatar/);
});

test('membership content distinguishes QuickTalk time and displays entitlement expiry', () => {
  const html = renderToStaticMarkup(createElement(MembershipContent, {
    account: { vip: true, vip_until: 1900000000, conversation_seconds: 780, quicktalk_seconds: 600, video_seconds: 120, trials_remaining: 1, trial_seconds: 60, max_session_seconds: 120, active: null,
      grants: [{ id: 1, kind: 'vip', conversation_seconds: 600, video_seconds: 120, expires_at: 1900000000 }] },
    error: '', onRefresh: async () => undefined, section: 'membership',
  }));
  assert.match(html, /QuickTalk 可用时长/);
  assert.match(html, /VIP 套餐额度/);
  assert.match(html, /30 天/);
});
