'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function hoverHarness() {
  const app = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
  const start = app.indexOf('function bindTopDockInteractions()');
  const end = app.indexOf('\nfunction renderTopDock()', start);
  const surfaceEvents = new Map();
  const windowEvents = new Map();
  const changes = [];
  const sizeEvents = new Map();
  const size = { addEventListener: (name, callback) => sizeEvents.set(name, callback) };
  const saved = [];
  const surface = { addEventListener: (name, callback) => surfaceEvents.set(name, callback) };
  const context = vm.createContext({
    topDockBound: false,
    topDockElements: () => ({ root: { querySelector: () => surface }, size, close: null }),
    setTopDockExpanded: (expanded) => changes.push(expanded),
    startTopDockTicker() {},
    renderTopDock() {},
    state: { settings: { topDockPinned: true, topDockAutoHideMs: 15000 } },
    window: {
      addEventListener: (name, callback) => windowEvents.set(name, callback),
      tokenMonitor: { updateSettings: async (patch) => { saved.push(patch.topDockCompact); return patch; } }
    }
  });
  vm.runInContext(`${app.slice(start, end)}\nbindTopDockInteractions();`, context);
  return { surfaceEvents, windowEvents, changes, sizeEvents, size, saved };
}

test('hover expands and leaving collapses synchronously even with legacy pin and delay settings', () => {
  const { surfaceEvents, changes } = hoverHarness();
  surfaceEvents.get('mouseenter')();
  assert.deepEqual(changes, [true]);
  surfaceEvents.get('mouseleave')();
  assert.deepEqual(changes, [true, false]);
  surfaceEvents.get('mouseenter')();
  surfaceEvents.get('mouseleave')();
  assert.deepEqual(changes, [true, false, true, false]);
});

test('losing focus collapses the dock without leaving an expanded panel behind', () => {
  const { surfaceEvents, windowEvents, changes } = hoverHarness();
  surfaceEvents.get('mouseenter')();
  windowEvents.get('blur')();
  assert.deepEqual(changes, [true, false]);
});

test('the size button toggles and saves compact size then normal size', async () => {
  const { sizeEvents, size, saved } = hoverHarness();
  await sizeEvents.get('click')({ stopPropagation() {} });
  await sizeEvents.get('click')({ stopPropagation() {} });
  assert.deepEqual(saved, [true, false]);
  assert.equal(size.disabled, false);
});

test('a missing balance is shown as unknown rather than unlimited in the compact ring', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
  const start = app.indexOf('function topDockRingText(');
  const end = app.indexOf('\nfunction createTopDockChip(', start);
  const ringText = vm.runInNewContext(`${app.slice(start, end)}\ntopDockRingText`);
  const empty = { percent: null, usedTokens: null, balance: null };
  assert.equal(ringText(empty), '--');
  assert.equal(ringText({ ...empty, unlimited: true }), '∞');
});

test('expanded cards wire a console link through the external browser bridge', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/electron/renderer/app.js'), 'utf8');
  assert.match(app, /function appendTopDockConsoleLink\(/);
  assert.match(app, /button\.append\(icon, topDockElement\('span', '', '控制台'\)\)/);
  assert.match(app, /window\.tokenMonitor\?\.openExternal\?\.\(url\)/);
  assert.match(app, /appendTopDockConsoleLink\(card, row\);/);
});
