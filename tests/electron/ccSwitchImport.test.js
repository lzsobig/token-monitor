'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const {
  buildImportPlan,
  extractCodexProviders,
  readCcSwitchRows
} = require('../../src/electron/ccSwitchImport');

function providerRow(overrides = {}) {
  const config = overrides.config || [
    'model_provider = "custom"',
    '[model_providers.custom]',
    `base_url = "${overrides.baseUrl || 'https://relay.example.com/v1'}"`,
    'wire_api = "responses"'
  ].join('\n');
  return {
    name: overrides.name || 'Relay',
    id: overrides.id || 'relay-id',
    website_url: overrides.website_url || '',
    settings_config: JSON.stringify({
      auth: { OPENAI_API_KEY: overrides.apiKey || 'sk-relay-key' },
      config
    })
  };
}

test('extracts Codex relay endpoints and credentials from CC Switch rows', () => {
  const rows = extractCodexProviders([
    providerRow({ name: 'Relay A', baseUrl: 'https://relay.example.com/v1' }),
    providerRow({ name: 'Relay B', baseUrl: 'https://relay-b.example.com' })
  ]);

  assert.deepEqual(rows.map(({ name, baseUrl, apiKey }) => ({ name, baseUrl, apiKey })), [
    { name: 'Relay A', baseUrl: 'https://relay.example.com', apiKey: 'sk-relay-key' },
    { name: 'Relay B', baseUrl: 'https://relay-b.example.com', apiKey: 'sk-relay-key' }
  ]);
});

test('skips official and loopback providers while deduplicating endpoints', () => {
  const rows = extractCodexProviders([
    providerRow({ name: 'OpenAI Official', baseUrl: 'https://chatgpt.com/backend-api/codex' }),
    providerRow({ name: 'Local', baseUrl: 'http://127.0.0.1:8080/v1' }),
    providerRow({ name: 'Relay', baseUrl: 'https://relay.example.com/v1' }),
    providerRow({ name: 'Relay duplicate', baseUrl: 'https://relay.example.com' })
  ]);

  assert.deepEqual(rows.map((row) => row.name), ['Relay']);
});

test('builds DeepSeek and third-party import plans without replacing existing credentials', () => {
  const plan = buildImportPlan({
    rows: [
      providerRow({
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-deepseek'
      }),
      providerRow({
        name: 'Sub2API',
        baseUrl: 'https://sub.example.com/v1',
        apiKey: 'sk-sub2'
      }),
      providerRow({
        name: 'NewAPI',
        baseUrl: 'https://new.example.com/v1',
        apiKey: 'sk-new'
      })
    ],
    existingProfiles: {
      Existing: {
        adapter: 'newapi-token',
        baseUrl: 'https://new.example.com',
        apiKey: 'sk-new',
        enabled: true
      }
    }
  });

  assert.equal(plan.deepseekApiKey, 'sk-deepseek');
  assert.equal(plan.profiles['Sub2API'].adapter, 'sub2api');
  assert.equal(plan.profiles['Sub2API'].baseUrl, 'https://sub.example.com');
  assert.equal(plan.profiles['NewAPI'], undefined);
  assert.deepEqual(plan.imported, ['DeepSeek', 'Sub2API']);
});

test('does not overwrite an existing DeepSeek key', () => {
  const plan = buildImportPlan({
    rows: [providerRow({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-imported'
    })],
    existingDeepSeekApiKey: 'sk-existing'
  });

  assert.equal(plan.deepseekApiKey, '');
  assert.deepEqual(plan.imported, []);
});

test('maps the WorkBuddy2API relay to its aggregate quota adapter', () => {
  const plan = buildImportPlan({
    rows: [
      providerRow({
        name: 'WB2 DeepSeek API',
        baseUrl: 'https://wb2api.lzso.top/v1',
        apiKey: 'sk-wb2'
      })
    ]
  });

  assert.equal(plan.profiles.WorkBuddy2API.adapter, 'workbuddy2api');
  assert.equal(plan.profiles.WorkBuddy2API.baseUrl, 'https://wb2api.lzso.top');
  assert.equal(plan.profiles.WorkBuddy2API.apiKey, 'sk-wb2');
});

test('prefers the WB2-named key over a generic NewAPI key on the same host', () => {
  const plan = buildImportPlan({
    rows: [
      providerRow({
        name: 'NewAPI',
        baseUrl: 'https://wb2api.lzso.top/v1',
        apiKey: 'sk-generic'
      }),
      providerRow({
        name: 'WB2 DeepSeek API',
        baseUrl: 'https://wb2api.lzso.top/v1',
        apiKey: 'sk-wb2'
      })
    ]
  });

  assert.equal(plan.profiles.WorkBuddy2API.apiKey, 'sk-wb2');
  assert.deepEqual(plan.imported, ['NewAPI', 'WB2 DeepSeek API']);
});

test('reads Codex rows from a CC Switch SQLite database read-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-switch-import-'));
  const dbPath = path.join(dir, 'cc-switch.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE providers (
      id TEXT NOT NULL,
      app_type TEXT NOT NULL,
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL,
      website_url TEXT
    )
  `);
  db.prepare(`
    INSERT INTO providers (id, app_type, name, settings_config, website_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'relay-id',
    'codex',
    'Relay',
    providerRow().settings_config,
    'https://relay.example.com'
  );
  db.close();

  const rows = readCcSwitchRows(dbPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Relay');
  assert.equal(rows[0].app_type, 'codex');
});
