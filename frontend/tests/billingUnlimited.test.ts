import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { quotaAvailable, activityDescription, planUsageText, type Activity, type Entitlements } from '../src/features/billing/api';
import { QuotaSummary } from '../src/features/billing/MembershipDialog';

const monthly = { vip: true, vip_until: 1900000000, unlimited: true, unlimited_until: 1900000000,
  conversation_seconds: 0, quicktalk_seconds: 0, video_seconds: 0, trials_remaining: 0,
  trial_seconds: 60 } as Entitlements;

test('monthly VIP unlocks conversation and video and shows membership validity instead of minute balances', t => {
  t.mock.method(Date, 'now', () => (1900000000 - 3 * 86400) * 1000);
  for (const kind of ['mock', 'quicktalk', 'video']) assert.equal(quotaAvailable(monthly, kind), true);
  const html = renderToStaticMarkup(createElement(QuotaSummary, { account: monthly }));
  assert.match(html, /VIP 到期时间/);
  assert.match(html, /剩余有效期/);
  assert.match(html, /3 天/);
  assert.ok(html.includes(new Date(1900000000 * 1000).toLocaleString('zh-CN')));
  assert.doesNotMatch(html, /QuickTalk 可用时长|对话可用总时长|视频可用时长/);
  assert.doesNotMatch(html, /0分|0 次/);
});

test('membership validity distinguishes the last day, expiry and an account without VIP', t => {
  t.mock.method(Date, 'now', () => 1900000000 * 1000);
  const render = (account: Entitlements) => renderToStaticMarkup(createElement(QuotaSummary, { account }));
  const lastDay = render({ ...monthly, vip_until: 1900003600 });
  assert.match(lastDay, /不足 1 天/);
  const expired = render(monthly);
  assert.match(expired, /VIP 已到期/);
  assert.doesNotMatch(expired, /VIP 已开通|剩余 [1-9]/);
  const free = render({ ...monthly, vip: false, vip_until: null, unlimited: false, conversation_seconds: 180 });
  assert.match(free, /尚未开通 VIP/);
  assert.match(free, /开通后显示到期时间/);
  assert.match(free, /3分/);
  assert.doesNotMatch(free, /VIP 已到期/);
});

test('plan and settlement descriptions distinguish monthly access from finite quota', () => {
  assert.equal(planUsageText({ unlimited: true, conversation_seconds: 0, video_seconds: 0 }), '对话、视频不限总时长');
  assert.equal(planUsageText({ conversation_seconds: 600, video_seconds: 120 }), '对话 10分 · 视频 2分');
  const task = { unlimited: true, state: 'finished', used_seconds: 95 } as Activity;
  assert.equal(activityDescription(task), '使用 1分35秒 · VIP 不扣减总额度');
});
