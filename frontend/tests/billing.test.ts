import assert from 'node:assert/strict';
import test from 'node:test';
import { quotaAvailable, type Entitlements } from '../src/features/billing/api';

test('free conversation seconds never unlock QuickTalk after trials are exhausted', () => {
  const account = { conversation_seconds: 180, quicktalk_seconds: 0, video_seconds: 0, trials_remaining: 0 } as Entitlements;
  assert.equal(quotaAvailable(account, 'mock'), true);
  assert.equal(quotaAvailable(account, 'quicktalk'), false);
  assert.equal(quotaAvailable(account, 'video'), false);
  assert.equal(quotaAvailable({ ...account, trials_remaining: 1 }, 'quicktalk'), true);
  assert.equal(quotaAvailable({ ...account, quicktalk_seconds: 1 }, 'quicktalk'), true);
});
