'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatCountdown,
  normalizeTopDockSettings,
  topDockProvidersWithUsageFallback,
  topDockBounds,
  topDockConsoleUrl,
  topDockProviderRows
} = require('../../src/electron/renderer/topDock/topDockModel');

test('top dock settings use compact defaults and clamp auto-collapse', () => {
  assert.deepEqual(normalizeTopDockSettings({}), {
    topDockEnabled: true,
    topDockCompact: false,
    topDockRelayAccounts: null,
    topDockPinned: false,
    topDockAutoHideMs: 1200,
    topDockWidth: 680,
    topDockCollapsedHeight: 44,
    topDockExpandedHeight: 220
  });
  assert.equal(normalizeTopDockSettings({ topDockAutoHideMs: 50 }).topDockAutoHideMs, 800);
  assert.equal(normalizeTopDockSettings({ topDockAutoHideMs: 99999 }).topDockAutoHideMs, 15000);
});

test('top dock bounds stay centered at the top and grow downward', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  assert.deepEqual(topDockBounds({
    workArea,
    width: 760,
    collapsedHeight: 52,
    expandedHeight: 420,
    expanded: false
  }), { x: 572, y: 0, width: 776, height: 68 });
  assert.deepEqual(topDockBounds({
    workArea,
    width: 760,
    collapsedHeight: 52,
    expandedHeight: 420,
    expanded: true
  }), { x: 572, y: 0, width: 776, height: 436 });
});

test('compact TopDock scales the whole surface and transparent gutters to 80 percent', () => {
  assert.equal(normalizeTopDockSettings({ topDockCompact: 'true' }).topDockCompact, true);
  const options = { workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scale: 0.8 };
  assert.deepEqual(topDockBounds(options), { x: 682, y: 0, width: 557, height: 48 });
  assert.deepEqual(topDockBounds({ ...options, expanded: true }), {
    x: 682, y: 0, width: 557, height: 189
  });
});

test('only configured live providers become top dock rows', () => {
  const now = Date.parse('2026-10-19T12:00:00.000Z');
  const rows = topDockProviderRows([
    {
      provider: 'codex',
      status: 'ok',
      windows: [{ remainingPercent: 62, resetsAt: '2026-10-19T14:00:00.000Z' }]
    },
    {
      provider: 'antigravity',
      status: 'notConfigured',
      windows: []
    },
    {
      provider: 'deepseek',
      status: 'ok',
      balance: { amount: 31.8, currency: 'CNY' },
      windows: [{ metric: 'credits', remaining: 31.8, currency: 'CNY', showMeter: false }]
    }
  ], { now, limit: 6 });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].provider, 'codex');
  assert.equal(rows[0].percent, 62);
  assert.equal(rows[0].tone, 'good');
  assert.equal(rows[0].countdown, '02:00:00');
  assert.equal(rows[1].provider, 'deepseek');
  assert.equal(rows[1].balance, 31.8);
  assert.equal(rows[1].currency, 'CNY');
  assert.equal(rows[1].tone, 'neutral');
});

test('does not show unlimited-only relays as quota cards', () => {
  const rows = topDockProviderRows([{
    provider: 'thirdparty',
    accountName: 'Unlimited relay',
    status: 'ok',
    windows: [{ kind: 'billing', metric: 'credits', detail: 'Unlimited', showMeter: false }]
  }], { now: Date.now() });
  assert.deepEqual(rows, []);
});

test('quota colors become amber and red as remaining percentage falls', () => {
  const now = Date.now();
  const rows = topDockProviderRows([
    { provider: 'a', status: 'ok', windows: [{ remainingPercent: 35 }] },
    { provider: 'b', status: 'ok', windows: [{ remainingPercent: 8 }] }
  ], { now });
  assert.deepEqual(rows.map((row) => row.tone), ['warn', 'danger']);
});

test('usage-only relay windows stay visible without inventing a quota', () => {
  const now = Date.parse('2026-10-19T12:00:00.000Z');
  const rows = topDockProviderRows([{
    provider: 'thirdparty',
    accountName: 'WorkBuddy2API',
    status: 'ok',
    windows: [{
      kind: 'daily',
      label: 'Today used',
      used: 58_000_000,
      showMeter: false,
      resetsAt: '2026-10-19T16:00:00.000Z'
    }]
  }], { now });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].usedTokens, 58_000_000);
  assert.equal(rows[0].percent, null);
  assert.equal(rows[0].balance, null);
  assert.equal(rows[0].countdown, '04:00:00');
  assert.equal(rows[0].tone, 'neutral');
});

test('prioritizes Codex, DeepSeek and WorkBuddy2API before other relays', () => {
  const now = Date.parse('2026-10-19T12:00:00.000Z');
  const rows = topDockProviderRows([
    {
      provider: 'thirdparty',
      accountName: 'Other Relay',
      status: 'ok',
      windows: [{ kind: 'daily', label: 'Today used', used: 1, showMeter: false }]
    },
    {
      provider: 'thirdparty',
      accountName: 'WorkBuddy2API',
      status: 'ok',
      windows: [{ kind: 'daily', label: 'Today used', used: 2, showMeter: false }]
    },
    {
      provider: 'deepseek',
      status: 'ok',
      windows: [{ metric: 'credits', remaining: 4.59, currency: 'CNY', showMeter: false }]
    },
    {
      provider: 'codex',
      status: 'ok',
      windows: [{ remainingPercent: 50 }]
    }
  ], { now });

  assert.deepEqual(rows.map((row) => row.provider), ['codex', 'deepseek', 'thirdparty', 'thirdparty']);
  assert.equal(rows[2].accountName, 'WorkBuddy2API');
});

test('adds today Codex usage when subscription limits are unavailable', () => {
  const providers = topDockProvidersWithUsageFallback(
    [{ provider: 'deepseek', status: 'ok', windows: [] }],
    { codex: 130_000_000 }
  );
  assert.equal(providers.length, 2);
  assert.equal(providers[1].provider, 'codex');
  assert.equal(providers[1].windows[0].used, 130_000_000);
  assert.equal(providers[1].windows[0].showMeter, false);
});

test('does not duplicate an already available Codex limit row', () => {
  const providers = topDockProvidersWithUsageFallback(
    [{ provider: 'codex', status: 'ok', windows: [{ remainingPercent: 50 }] }],
    { codex: 130_000_000 }
  );
  assert.equal(providers.length, 1);
});

test('resolves official and relay console URLs for top dock cards', () => {
  const profiles = {
    'WorkBuddy2API': { baseUrl: 'https://wb2api.lzso.top' },
    Relay: { baseUrl: 'https://relay.example.com/v1' }
  };
  assert.equal(
    topDockConsoleUrl({ provider: 'codex' }, profiles),
    'https://chatgpt.com/codex/settings/usage'
  );
  assert.equal(
    topDockConsoleUrl({ provider: 'deepseek' }, profiles),
    'https://platform.deepseek.com/usage'
  );
  assert.equal(
    topDockConsoleUrl({ provider: 'thirdparty', accountName: 'WorkBuddy2API' }, profiles),
    'https://wb2api.lzso.top/panel/#accounts'
  );
  assert.equal(
    topDockConsoleUrl({ provider: 'thirdparty', accountName: 'Relay' }, profiles),
    'https://relay.example.com/'
  );
  assert.equal(topDockConsoleUrl({ provider: 'thirdparty', accountName: 'Missing' }, profiles), '');
});

test('countdown formatting stays readable across days and minutes', () => {
  assert.equal(formatCountdown(0), '--');
  assert.equal(formatCountdown(59_000), '<1m');
  assert.equal(formatCountdown(12 * 60_000 + 34_000), '12m');
  assert.equal(formatCountdown(2 * 60 * 60_000 + 3 * 60_000 + 4_000), '02:03:04');
  assert.equal(formatCountdown(26 * 60 * 60_000), '1d 02h');
});

test('Codex keeps the five-hour and weekly quota and reset clocks independently', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  const [row] = topDockProviderRows([{
    provider: 'codex', status: 'ok', windows: [
      { kind: 'weekly', remainingPercent: 27, resetsAt: '2026-10-21T12:00:00Z' },
      { kind: 'session', usedPercent: 10, resetsAt: '2026-10-19T14:00:00Z' },
      { kind: 'session', additional: true, remainingPercent: 1, resetsAt: '2026-10-19T13:00:00Z' }
    ]
  }], { now });
  assert.equal(row.percent, 27);
  assert.deepEqual(row.codexWindows.map((quota) => [quota.kind, quota.percent, quota.countdown]), [
    ['session', 90, '02:00:00'], ['weekly', 27, '2d 00h']
  ]);
});

test('Codex missing weekly quota stays unknown and does not reuse the five-hour reset', () => {
  const [row] = topDockProviderRows([{
    provider: 'codex', status: 'ok', resetsAt: '2026-10-19T14:00:00Z', windows: [
      { kind: 'session', remainingPercent: 80, resetsAt: '2026-10-19T14:00:00Z' },
      { kind: 'weekly', additional: true, remainingPercent: 50 }
    ]
  }], { now: Date.parse('2026-10-19T12:00:00Z') });
  assert.equal(row.codexWindows[1].percent, null);
  assert.equal(row.codexWindows[1].resetAt, null);
  assert.equal(row.codexWindows[1].countdown, '--');
});

test('Codex local token usage is not presented as subscription quota', () => {
  const [row] = topDockProviderRows(topDockProvidersWithUsageFallback([], { codex: 1000 }));
  assert.equal(row.usedTokens, 1000);
  assert.deepEqual(row.codexWindows, []);
});

test('selected relay balance failures stay visible and do not become unlimited or token usage', () => {
  const rows = topDockProviderRows([
    { provider: 'thirdparty', accountName: 'Expired', status: 'unauthorized', windows: [] },
    { provider: 'thirdparty', accountName: 'Local', status: 'ok', windows: [{ used: 123, showMeter: false }] },
    { provider: 'thirdparty', accountName: 'Other', status: 'ok', balance: { amount: 10 }, windows: [] }
  ], { accountNames: ['Expired', 'Local'], balanceOnly: true });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].balanceNote, '需要重新登录');
  assert.equal(rows[1].balanceNote, '未提供计费余额');
  assert.equal(rows[1].usedTokens, null);
});

test('relay balance-only display keeps money instead of substituting a quota percentage', () => {
  const [row] = topDockProviderRows([{
    provider: 'thirdparty', accountName: 'Relay', status: 'ok',
    balance: { amount: 10, currency: 'CNY' },
    windows: [{ metric: 'credits', usedPercent: 50, remaining: 10, resetsAt: '2026-10-20T00:00:00Z' }]
  }], { accountNames: ['Relay'], balanceOnly: true });
  assert.equal(row.balance, 10);
  assert.equal(row.currency, 'CNY');
  assert.equal(row.percent, null);
  assert.equal(row.resetAt, null);
});

test('a reconnected relay replaces stale errors and older snapshots for the same named account', () => {
  const [row, extra] = topDockProviderRows([
    { provider: 'thirdparty', accountName: 'Relay', status: 'unavailable', windows: [] },
    { provider: 'thirdparty', accountName: 'Relay', status: 'ok', balance: { amount: 5 }, updatedAt: '2026-10-18T00:00:00Z' },
    { provider: 'thirdparty', accountName: 'Relay', status: 'ok', balance: { amount: 4 }, updatedAt: '2026-10-19T00:00:00Z' }
  ], { accountNames: ['Relay'], balanceOnly: true });
  assert.equal(row.balance, 4);
  assert.equal(extra, undefined);
});

test('WorkBuddy2API keeps today token usage including zero while other relays remain balance-only', () => {
  for (const used of [0, 157_200_000]) {
    const [row] = topDockProviderRows([{
      provider: 'thirdparty', adapterId: 'workbuddy2api', accountName: 'WorkBuddy2API', status: 'ok',
      windows: [{ kind: 'daily', used, showMeter: false, resetsAt: '2026-10-19T16:00:00Z' }]
    }], { accountNames: ['WorkBuddy2API'], balanceOnly: true });
    assert.equal(row.usedTokens, used);
    assert.equal(row.balanceNote, '');
    assert.equal(row.windowLabel, '今日已用');
    assert.equal(row.resetAt, Date.parse('2026-10-19T16:00:00Z'));
  }
});
