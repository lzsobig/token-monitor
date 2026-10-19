'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '../../src/electron/main.js'), 'utf8');

function mainFunction(name, end, globals) {
  const start = main.indexOf(`function ${name}(`);
  const finish = main.indexOf(`\n${end}`, start);
  assert.ok(start >= 0 && finish > start);
  return vm.runInNewContext(`${main.slice(start, finish)}\n${name}`, globals);
}

test('TopDock uses the normal window layer even when legacy preferences ask for pinning', () => {
  const levels = [];
  const apply = mainFunction('applyWindowSettings', 'function nativeBlurEnabled(', {
    settings: { topDockEnabled: true, windowBehavior: 'pinned', keepAboveTaskbar: true },
    floatingBubbleState: { collapsed: true },
    mainWindow: { setAlwaysOnTop: (value) => levels.push(value) },
    syncTaskbarZOrder() {},
    floatingAlwaysOnTopLevel: () => 'floating'
  });
  apply();
  assert.deepEqual(levels, [false]);
});

test('TopDock stops the taskbar keeper before it can re-raise the window', () => {
  let stopped = 0;
  const sync = mainFunction('syncTaskbarZOrder', '// Losing activation', {
    settings: { topDockEnabled: true },
    stopTaskbarZOrderKeeper: () => { stopped += 1; }
  });
  sync();
  assert.equal(stopped, 1);
});

test('TopDock console links allow official pages and configured relay hosts', () => {
  assert.match(main, /function configuredThirdPartyConsoleHosts\(\)/);
  assert.match(main, /host === 'chatgpt\.com'[\s\S]*startsWith\('\/codex'\)/);
  assert.match(main, /host === 'platform\.deepseek\.com'/);
  assert.match(main, /thirdPartyHosts\.has\(host\)/);
});
