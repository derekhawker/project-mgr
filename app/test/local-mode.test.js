import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordCommandFailure, getDiagnostics } from '../src/diagnostics.js';
import { isBrowserFixture } from '../src/runtime-mode.js';

test('local entry points do not start Tauri and live is explicit without recursive beforeDevCommand', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  assert.equal(pkg.scripts.dev, 'vite --host 127.0.0.1 --port 1420 --strictPort');
  assert.equal(pkg.scripts['tauri:dev'], 'npm run dev');
  assert.equal(pkg.scripts.live, 'tauri dev');
  assert.equal(tauri.build.beforeDevCommand, 'npm run dev:server');
  assert.equal(pkg.scripts['dev:server'], pkg.scripts.dev);
  assert.equal(pkg.scripts.test, 'node scripts/test-safe.js');
  assert.match(readFileSync(new URL('../scripts/test-safe.js', import.meta.url), 'utf8'), /model-loader-integration\.test\.js/);
});

test('mode selection is explicit and never needs to launch the live backend', () => {
  assert.equal(isBrowserFixture(true, false), true);
  assert.equal(isBrowserFixture(true, true), false);
  assert.equal(isBrowserFixture(false, true), false);
  assert.equal(isBrowserFixture(false, false), false);
});

test('diagnostics record bounded metadata without error or payload text', () => {
  const original = console.error;
  const output = [];
  console.error = (line) => output.push(line);
  try {
    for (let i = 0; i < 105; i++) recordCommandFailure('opencode_session_prompt', 'command failure');
    assert.equal(getDiagnostics().length, 100);
    assert.deepEqual(Object.keys(getDiagnostics()[0]), ['time', 'command', 'category']);
    assert.equal(output.at(-1), '[app diagnostic] command failure: opencode_session_prompt');
    const copy = getDiagnostics(); copy[0].command = 'changed';
    assert.equal(getDiagnostics()[0].command, 'opencode_session_prompt');
  } finally { console.error = original; }
});
