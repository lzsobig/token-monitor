'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { workbuddy2ApiQuota } = require('../../src/shared/providers/thirdparty/limits');

test('aggregates WorkBuddy2API daily used tokens without assuming a quota', () => {
  const now = Date.parse('2026-10-19T04:00:00.000Z');
  const quota = workbuddy2ApiQuota({
    accounts: [
      { token_usage: { daily_tokens: 10_000_000 } },
      { token_usage: { daily_tokens: 20_000_000 } },
      { token_usage: { daily_tokens: 30_000_000 } }
    ]
  }, { now });

  assert.equal(quota.window.used, 60_000_000);
  assert.equal(quota.window.limit, undefined);
  assert.equal(quota.window.remaining, undefined);
  assert.equal(quota.window.showMeter, false);
  assert.equal(quota.window.resetsAt, '2026-10-19T16:00:00.000Z');
  assert.equal(quota.balance.accounts, 3);
});

test('ignores stale daily counters and keeps today usage', () => {
  const quota = workbuddy2ApiQuota({
    accounts: [
      { token_usage: { daily_date: '2026-10-19', daily_tokens: 1 } },
      { token_usage: { daily_date: '2026-10-18', daily_tokens: 999 } },
      { token_usage: { daily_tokens: 3 } }
    ]
  }, { now: Date.parse('2026-10-19T04:00:00.000Z') });

  assert.equal(quota.window.used, 4);
});

test('returns null when WorkBuddy2API overview has no accounts', () => {
  assert.equal(workbuddy2ApiQuota({ accounts: [] }), null);
  assert.equal(workbuddy2ApiQuota(null), null);
});
