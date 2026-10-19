'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DEEPSEEK_HOST = 'api.deepseek.com';
const WORKBUDDY2API_HOST = 'wb2api.lzso.top';
const OFFICIAL_HOSTS = new Set([
  'chatgpt.com',
  'www.chatgpt.com',
  'api.openai.com',
  'openai.com'
]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    url.pathname = url.pathname.replace(/\/v1\/?$/iu, '').replace(/\/+$/u, '') || '/';
    return url.toString().replace(/\/$/u, '');
  } catch (_) {
    return '';
  }
}

function parseBaseUrlFromConfig(config) {
  if (typeof config !== 'string') return '';
  const match = config.match(/^\s*base_url\s*=\s*["']([^"']+)["']/imu);
  return match ? match[1] : '';
}

function parseSettingsConfig(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function parseAuth(auth) {
  if (auth && typeof auth === 'object') return auth;
  if (typeof auth !== 'string') return null;
  try {
    return JSON.parse(auth);
  } catch (_) {
    return null;
  }
}

function extractCodexProviders(rows) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || (row.app_type && row.app_type !== 'codex')) continue;
    const parsed = parseSettingsConfig(row.settings_config);
    if (!parsed) continue;
    const auth = parseAuth(parsed.auth);
    const apiKey = clean(auth?.OPENAI_API_KEY || auth?.api_key || auth?.apiKey);
    const baseUrl = normalizeBaseUrl(
      parseBaseUrlFromConfig(parsed.config)
      || row.website_url
      || ''
    );
    if (!apiKey || !baseUrl) continue;
    let url;
    try {
      url = new URL(baseUrl);
    } catch (_) {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (OFFICIAL_HOSTS.has(host) || LOOPBACK_HOSTS.has(host)) continue;
    const name = clean(row.name) || host;
    if (/^openai official\b/iu.test(name)) continue;
    const identity = `${baseUrl}\0${apiKey}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      id: clean(row.id),
      name,
      baseUrl,
      apiKey,
      websiteUrl: clean(row.website_url),
      host
    });
  }
  return out;
}

function profileAdapterFor(row) {
  const name = `${row.name} ${row.host}`.toLowerCase();
  if (row.host === WORKBUDDY2API_HOST) return 'workbuddy2api';
  return name.includes('sub2api') || row.host.startsWith('sub2.')
    ? 'sub2api'
    : 'newapi-token';
}

function uniqueProfileName(baseName, profiles) {
  const preferred = clean(baseName) || 'Relay';
  if (!Object.hasOwn(profiles, preferred)) return preferred;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${preferred} ${index}`;
    if (!Object.hasOwn(profiles, candidate)) return candidate;
  }
  return `${preferred} ${Date.now()}`;
}

function existingIdentity(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const baseUrl = normalizeBaseUrl(profile.baseUrl);
  const credential = clean(profile.apiKey || profile.accessToken || profile.refreshToken);
  return baseUrl && credential ? `${baseUrl}\0${credential}` : '';
}

function buildImportPlan({
  rows,
  existingProfiles = {},
  existingDeepSeekApiKey = ''
} = {}) {
  const profiles = { ...(existingProfiles || {}) };
  const seen = new Set(Object.values(profiles).map(existingIdentity).filter(Boolean));
  let deepseekApiKey = '';
  const imported = [];

  for (const row of extractCodexProviders(rows)) {
    if (row.host === DEEPSEEK_HOST) {
      if (!clean(existingDeepSeekApiKey) && !deepseekApiKey) {
        deepseekApiKey = row.apiKey;
        imported.push(row.name);
      }
      continue;
    }
    const identity = `${row.baseUrl}\0${row.apiKey}`;
    if (seen.has(identity)) continue;
    const adapter = profileAdapterFor(row);
    if (adapter === 'workbuddy2api') {
      const existing = Object.entries(profiles).find(([, profile]) => (
        profile?.adapter === adapter
        && normalizeBaseUrl(profile.baseUrl) === row.baseUrl
      ));
      const wb2Named = /(?:^|\b)wb2\b/iu.test(row.name);
      if (existing && !wb2Named) continue;
      const name = existing?.[0] || uniqueProfileName('WorkBuddy2API', profiles);
      profiles[name] = {
        ...(existing?.[1] || {}),
        adapter,
        baseUrl: row.baseUrl,
        apiKey: row.apiKey,
        enabled: existing?.[1]?.enabled !== false
      };
      seen.add(identity);
      imported.push(row.name);
      continue;
    }
    const name = uniqueProfileName(
      row.name,
      profiles
    );
    profiles[name] = adapter === 'sub2api'
      ? {
          adapter,
          baseUrl: row.baseUrl,
          accessToken: row.apiKey,
          enabled: true
        }
      : {
          adapter,
          baseUrl: row.baseUrl,
          apiKey: row.apiKey,
          enabled: true
        };
    seen.add(identity);
    imported.push(row.name);
  }

  return { deepseekApiKey, profiles, imported };
}

function readCcSwitchRows(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const table = db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'providers'"
    ).get();
    if (!table?.ok) return [];
    return db.prepare(`
      SELECT id, app_type, name, settings_config, website_url
      FROM providers
      WHERE app_type = 'codex'
      ORDER BY name
    `).all();
  } catch (_) {
    return [];
  } finally {
    try {
      db?.close();
    } catch (_) {}
  }
}

module.exports = {
  buildImportPlan,
  extractCodexProviders,
  normalizeBaseUrl,
  parseBaseUrlFromConfig,
  readCcSwitchRows
};
