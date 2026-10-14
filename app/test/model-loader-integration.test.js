import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import { initializeModelSelector } from '../src/model-selector.js';
import { invokeCommand } from '../src/command-contract.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = resolve(appRoot, 'src-tauri/Cargo.toml');

function runHarness(command = 'cargo', args = ['run', '--quiet', '--manifest-path', manifest, '--features', 'integration-test-harnesses', '--bin', 'model-loader-harness']) {
  const result = spawnSync(command, args, { cwd: appRoot, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  let payload;
  try { payload = JSON.parse(result.stdout.trim()); } catch {
    throw new Error(`model-loader harness emitted malformed JSON (exit ${result.status}): ${result.stdout}`);
  }
  if (result.status !== 0 || payload.ok !== 'true') {
    throw new Error(payload.error || `model-loader harness exited ${result.status}`);
  }
  return payload;
}

function runWireHarness() {
  const result = spawnSync('cargo', [
    'run', '--quiet', '--manifest-path', manifest, '--features', 'integration-test-harnesses',
    '--bin', 'wire-contract-harness',
  ], { cwd: appRoot, encoding: 'utf8', timeout: 120_000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || 'Rust wire-contract harness failed');
  return JSON.parse(result.stdout.trim());
}

test('production model loader makes serialized Rust catalog consumable by selector state', async () => {
  const { info, catalog } = runHarness();
  const { defaultModel } = runWireHarness();
  assert.match(info.version, /\S+/);
  assert.equal(typeof info.pid, 'number');
  assert.ok(catalog.length > 0);
  assert.ok(catalog.every((entry) => entry.enabled && entry.status !== 'deprecated'));
  assert.ok(!catalog.some((entry) => `${entry.providerID}/${entry.id}` === 'opencode/exo-free'));
  assert.ok(catalog.every((entry) => entry.providerID && entry.id && typeof entry.name === 'string'));

  const window = new Window();
  const select = window.document.createElement('select');
  const submit = window.document.createElement('button');
  submit.disabled = true;
  let ready = false;
  let unavailableDefault;
  const transportCalls = [];
  const transport = async (name, payload) => {
    transportCalls.push({ name, payload });
    // Both replies are Rust-serialized values; production command validation
    // runs before the selector consumes them.
    const result = name === 'opencode_models' ? catalog : defaultModel;
    return invokeCommand(async () => result, name, payload);
  };
  const previousDocument = globalThis.document;
  globalThis.document = window.document;
  try {
    await initializeModelSelector({
      invoke: transport,
      select,
      onReady: () => { ready = true; submit.disabled = false; },
      onDefaultUnavailable: (value) => { unavailableDefault = value; },
      onError: () => { throw new Error('unexpected model error'); },
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    window.happyDOM.abort();
  }
  assert.equal(ready, true);
  assert.equal(submit.disabled, false);
  assert.equal(select.disabled, false);
  assert.equal(select.getAttribute('aria-busy'), 'false');
  assert.deepEqual(transportCalls, [
    { name: 'opencode_model_default', payload: undefined },
    { name: 'opencode_models', payload: undefined },
  ]);
  assert.equal(select.options.length, catalog.length);
  assert.ok(Array.from(select.options).every((option) => option.value && option.textContent));
  const defaultValue = JSON.stringify({
    providerId: defaultModel.providerId,
    id: defaultModel.id,
  });
  const defaultIsAvailable = catalog.some((entry) =>
    entry.providerID === defaultModel.providerId && entry.id === defaultModel.id);
  if (defaultIsAvailable) {
    assert.equal(select.value, defaultValue);
    assert.equal(unavailableDefault, undefined);
  } else {
    assert.equal(select.selectedIndex, 0);
    assert.deepEqual(unavailableDefault, defaultModel);
    assert.equal(Array.from(select.options).some((option) => option.value === defaultValue), false);
  }
});

test('model selector DOM becomes disabled, empty, and visibly erroneous on CLI/API or empty-catalog failure', async () => {
  const window = new Window();
  const select = window.document.createElement('select');
  const staleOption = window.document.createElement('option');
  staleOption.textContent = 'stale prior choice';
  staleOption.value = '{"providerId":"old","id":"old"}';
  select.append(staleOption);
  const submit = window.document.createElement('button');
  const errorMessage = window.document.createElement('p');
  const defaultModel = { providerId: 'openai', id: 'gpt-6-luna' };
  for (const failure of [
    {
      invoke: async (name) => {
        if (name === 'opencode_model_default') return defaultModel;
        throw new Error('OpenCode API returned HTTP 503');
      },
      match: /HTTP 503/,
    },
    {
      invoke: async (name) => name === 'opencode_model_default' ? defaultModel : [],
      match: /No enabled OpenCode models/,
    },
  ]) {
    let ready = true;
    submit.disabled = false;
    await initializeModelSelector({
      invoke: failure.invoke,
      select,
      onReady: () => { ready = true; submit.disabled = false; },
      onError: (error) => { ready = false; submit.disabled = true; errorMessage.textContent = String(error); },
    });
    assert.equal(ready, false);
    assert.equal(select.disabled, true);
    assert.equal(select.options.length, 0);
    assert.equal(select.getAttribute('aria-busy'), 'false');
    assert.equal(submit.disabled, true);
    assert.match(errorMessage.textContent, failure.match);
    const staleOption = window.document.createElement('option');
    staleOption.value = 'stale';
    select.append(staleOption);
  }
  window.happyDOM.abort();
});

test('unavailable app default is reported without inventing a selector option', async () => {
  const window = new Window();
  const select = window.document.createElement('select');
  const warning = window.document.createElement('p');
  const fallback = { providerID: 'provider-live', id: 'available', name: 'Available model', enabled: true, status: null };
  const previousDocument = globalThis.document;
  globalThis.document = window.document;
  try {
    await initializeModelSelector({
      invoke: async (name) => name === 'opencode_model_default'
        ? { providerId: 'provider-missing', id: 'not-in-catalog' }
        : [fallback],
      select,
      onReady: () => {},
      onDefaultUnavailable: ({ providerId, id }) => {
        warning.textContent = `Configured default model ${providerId}/${id} is unavailable.`;
      },
      onError: (error) => { throw error; },
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    window.happyDOM.abort();
  }
  assert.equal(select.disabled, false);
  assert.equal(select.options.length, 1);
  assert.equal(select.selectedIndex, 0);
  assert.deepEqual(JSON.parse(select.value), { providerId: 'provider-live', id: 'available' });
  assert.equal(select.options.length, 1, 'do not synthesize the unavailable default');
  assert.match(warning.textContent, /provider-missing\/not-in-catalog/);
});

test('model loader rejects malformed or failed harness output', () => {
  const malformed = spawnSync(process.execPath, ['-e', 'process.stdout.write("not-json"); process.exit(1)'], { encoding: 'utf8' });
  assert.throws(() => runHarness(process.execPath, ['-e', 'process.stdout.write("not-json"); process.exit(1)']), /malformed JSON/);
  assert.equal(malformed.status, 1);
  assert.throws(() => runHarness(process.execPath, ['-e', 'console.log(JSON.stringify({ok:"false",error:"CLI unavailable"})); process.exit(1)']), /CLI unavailable/);
});
