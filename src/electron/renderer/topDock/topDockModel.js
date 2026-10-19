(function exposeTopDockModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorTopDockModel = api;
})(typeof window !== 'undefined' ? window : null, function createTopDockModel() {
  'use strict';

  const DEFAULTS = Object.freeze({
    topDockEnabled: true,
    topDockCompact: false,
    topDockRelayAccounts: null,
    topDockPinned: false,
    topDockAutoHideMs: 1200,
    topDockWidth: 680,
    topDockCollapsedHeight: 44,
    topDockExpandedHeight: 220
  });

  function booleanValue(value, fallback) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
  }

  function numberInRange(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function normalizeTopDockSettings(settings = {}) {
    return {
      topDockEnabled: booleanValue(settings.topDockEnabled, DEFAULTS.topDockEnabled),
      topDockCompact: booleanValue(settings.topDockCompact, DEFAULTS.topDockCompact),
      topDockRelayAccounts: Array.isArray(settings.topDockRelayAccounts)
        ? [...new Set(settings.topDockRelayAccounts.filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim()))].slice(0, 32)
        : null,
      topDockPinned: booleanValue(settings.topDockPinned, DEFAULTS.topDockPinned),
      topDockAutoHideMs: numberInRange(
        settings.topDockAutoHideMs,
        DEFAULTS.topDockAutoHideMs,
        800,
        15000
      ),
      topDockWidth: numberInRange(settings.topDockWidth, DEFAULTS.topDockWidth, 520, 1200),
      topDockCollapsedHeight: numberInRange(
        settings.topDockCollapsedHeight,
        DEFAULTS.topDockCollapsedHeight,
        42,
        80
      ),
      topDockExpandedHeight: numberInRange(
        settings.topDockExpandedHeight,
        DEFAULTS.topDockExpandedHeight,
        220,
        680
      )
    };
  }

  function topDockBounds({
    workArea,
    width,
    collapsedHeight,
    expandedHeight,
    expanded = false,
    scale = 1
  }) {
    if (!workArea) return null;
    // Transparent gutters keep the CSS corners and shadow inside the native window.
    const factor = scale === 0.8 ? 0.8 : 1;
    const gutter = 8 * factor;
    const actualWidth = Math.max(320 * factor, Math.min(
      (Number(width) || DEFAULTS.topDockWidth) * factor,
      Math.max(320 * factor, workArea.width - gutter * 2)
    ));
    const requestedHeight = expanded
      ? Number(expandedHeight) || DEFAULTS.topDockExpandedHeight
      : Number(collapsedHeight) || DEFAULTS.topDockCollapsedHeight;
    const actualHeight = Math.max(36 * factor, Math.min(
      requestedHeight * factor,
      Math.max(36 * factor, workArea.height - gutter * 2)
    ));
    return {
      x: Math.round(workArea.x + (workArea.width - actualWidth) / 2 - gutter),
      y: Math.round(workArea.y),
      width: Math.round(actualWidth + gutter * 2),
      height: Math.round(actualHeight + gutter * 2)
    };
  }

  function finiteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function percentForWindow(window) {
    const remaining = finiteNumber(window?.remainingPercent);
    if (remaining !== null) return Math.max(0, Math.min(100, remaining));
    const used = finiteNumber(window?.usedPercent);
    return used === null ? null : Math.max(0, Math.min(100, 100 - used));
  }

  function toneForPercent(percent) {
    if (percent === null) return 'neutral';
    if (percent < 20) return 'danger';
    if (percent < 50) return 'warn';
    return 'good';
  }

  function formatCountdown(milliseconds) {
    const ms = Number(milliseconds);
    if (!Number.isFinite(ms) || ms <= 0) return '--';
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 1) return '<1m';
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours < 24) {
      return `${String(totalHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
    }
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}d ${String(hours).padStart(2, '0')}h`;
  }

  function resetTimeFor(provider, windows) {
    const values = [
      ...windows.map((window) => window?.resetsAt),
      provider?.resetsAt,
      provider?.resetAt,
      provider?.resetTime
    ];
    for (const value of values) {
      const parsed = Date.parse(value || '');
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function balanceFor(provider, windows) {
    const balance = provider?.balance;
    const amount = finiteNumber(balance?.amount);
    if (amount !== null) {
      return { amount, currency: balance.currency || provider.currency || 'USD' };
    }
    const credits = windows.find((window) => window?.metric === 'credits');
    const remaining = finiteNumber(credits?.remaining);
    return remaining === null
      ? { amount: null, currency: credits?.currency || provider?.currency || 'USD' }
      : { amount: remaining, currency: credits.currency || provider.currency || 'USD' };
  }

  function topDockConsoleUrl(row, profiles = {}) {
    if (!row || typeof row !== 'object') return '';
    if (row.provider === 'codex') return 'https://chatgpt.com/codex/settings/usage';
    if (row.provider === 'deepseek') return 'https://platform.deepseek.com/usage';
    if (row.provider !== 'thirdparty') return '';
    if (row.accountName === 'WorkBuddy2API') return 'https://wb2api.lzso.top/panel/#accounts';
    const profile = profiles?.[row.accountName];
    try {
      const url = new URL(String(profile?.baseUrl || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return `${url.origin}/`;
    } catch (_) {
      return '';
    }
  }

  function topDockProvidersWithUsageFallback(providers, todayClients) {
    const out = Array.isArray(providers) ? [...providers] : [];
    if (out.some((provider) => provider?.provider === 'codex' && provider?.status === 'ok')) {
      return out;
    }
    const codexUsed = finiteNumber(todayClients?.codex);
    if (codexUsed === null || codexUsed <= 0) return out;
    out.push({
      provider: 'codex',
      status: 'ok',
      source: 'local-usage',
      windows: [{
        kind: 'daily',
        label: 'Today used',
        used: codexUsed,
        showMeter: false
      }]
    });
    return out;
  }

  function topDockProviderRows(providers, options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const limit = Math.max(1, Math.min(12, Math.round(Number(options.limit) || 6)));
    const rows = [];
    const selectedAccounts = Array.isArray(options.accountNames) ? new Set(options.accountNames) : null;
    const providerRank = { codex: 0, deepseek: 1, thirdparty: 2 };
    const orderedProviders = (Array.isArray(providers) ? providers : [])
      .map((provider, index) => ({ provider, index }))
      .sort((a, b) => {
        const rankA = providerRank[a.provider?.provider] ?? 99;
        const rankB = providerRank[b.provider?.provider] ?? 99;
        if (rankA !== rankB) return rankA - rankB;
        const wb2A = a.provider?.accountName === 'WorkBuddy2API' ? 0 : 1;
        const wb2B = b.provider?.accountName === 'WorkBuddy2API' ? 0 : 1;
        if (wb2A !== wb2B) return wb2A - wb2B;
        return a.index - b.index;
      })
      .map((entry) => entry.provider);
    for (const provider of orderedProviders) {
      if (!provider) continue;
      const selected = provider.provider === 'thirdparty' && selectedAccounts?.has(provider.accountName);
      const workbuddyUsage = provider.adapterId === 'workbuddy2api';
      const balanceOnly = selected && options.balanceOnly && !workbuddyUsage;
      if (provider.provider === 'thirdparty' && selectedAccounts && !selected) continue;
      if (provider.status !== 'ok' && !selected) continue;
      if (selected) {
        const winner = orderedProviders
          .filter((entry) => entry.provider === 'thirdparty' && entry.accountName === provider.accountName)
          .reduce((best, entry) => {
            if (!best) return entry;
            if ((entry.status === 'ok') !== (best.status === 'ok')) return entry.status === 'ok' ? entry : best;
            return (Date.parse(entry.updatedAt) || 0) > (Date.parse(best.updatedAt) || 0) ? entry : best;
          }, null);
        if (provider !== winner) continue;
      }
      const windows = Array.isArray(provider.windows) ? provider.windows : [];
      const metered = windows.filter((window) => window?.showMeter !== false
        && (provider.provider !== 'codex' || window?.additional !== true))
        .map((window) => ({ window, percent: percentForWindow(window) }))
        .filter((entry) => entry.percent !== null);
      metered.sort((a, b) => a.percent - b.percent);
      const primary = metered[0]?.window || windows.find((window) => window?.metric === 'credits') || null;
      const percent = balanceOnly ? null : metered.length ? metered[0].percent : null;
      const balance = balanceFor(provider, windows);
      const usageWindow = windows.find((window) => (
        window?.showMeter === false
        && finiteNumber(window?.used) !== null
      )) || null;
      const usedTokens = balanceOnly ? null : finiteNumber(usageWindow?.used);
      if (percent === null && balance.amount === null && usedTokens === null && !selected) continue;
      const balanceNote = selected && balance.amount === null && usedTokens === null
        ? provider.status === 'unauthorized' ? '需要重新登录'
          : provider.status === 'ok' ? '未提供计费余额'
            : provider.status === 'notConfigured' ? '等待连接' : '余额暂不可用'
        : '';
      const primaryWindow = primary || usageWindow;
      const resetAt = balanceOnly ? null : resetTimeFor(provider, primaryWindow ? [primaryWindow] : windows);
      const codexWindows = provider.provider === 'codex'
        ? ['session', 'weekly'].map((kind) => {
            const quota = windows.find((window) => window?.kind === kind && window?.additional !== true);
            const remaining = percentForWindow(quota);
            const quotaResetAt = resetTimeFor({}, quota ? [quota] : []);
            return {
              kind,
              label: kind === 'session' ? '5 小时额度' : '周额度',
              percent: remaining,
              tone: toneForPercent(remaining),
              resetAt: quotaResetAt,
              countdown: quotaResetAt === null ? '--' : formatCountdown(quotaResetAt - now)
            };
          })
        : [];
      rows.push({
        provider: provider.provider,
        accountName: provider.accountName || provider.accountLabel || '',
        accountKey: provider.accountKey || '',
        percent,
        tone: toneForPercent(percent),
        balance: balance.amount,
        currency: balance.currency,
        usedTokens,
        balanceNote,
        resetAt,
        countdown: resetAt === null ? '--' : formatCountdown(resetAt - now),
        windowLabel: workbuddyUsage ? '今日已用' : primaryWindow?.label || '',
        codexWindows: codexWindows.some((quota) => quota.percent !== null) ? codexWindows : [],
        unlimited: windows.some((window) => (
          window?.showMeter === false
          && String(window?.detail || '').toLowerCase() === 'unlimited'
        ))
      });
      if (rows.length >= limit) break;
    }
    return rows;
  }

  return {
    DEFAULTS,
    formatCountdown,
    normalizeTopDockSettings,
    toneForPercent,
    topDockBounds,
    topDockConsoleUrl,
    topDockProviderRows,
    topDockProvidersWithUsageFallback
  };
});
