import assert from 'node:assert/strict';
import test from 'node:test';
import { createQuickRequestCommands } from '../src/tauri-commands.js';

test('loads the model setting and available model list from prototype info', async () => {
  const calls = [];
  const result = {
    version: '2.0.27',
    directory: '/tmp/quick-requests',
    defaultModel: 'openai/gpt-6-luna',
    models: [{ reference: 'openai/gpt-6-luna', name: 'GPT-6 Luna' }],
  };
  const commands = createQuickRequestCommands(async (...args) => {
    calls.push(args);
    return result;
  });

  assert.equal(await commands.prototypeInfo(), result);
  assert.deepEqual(calls, [['prototype_info']]);
});

test('starts a Quick Request with its explicitly selected model', async () => {
  const calls = [];
  const result = { sessionId: 'ses_123', title: 'Quick Request', serverVersion: '2.0.27' };
  const commands = createQuickRequestCommands(async (...args) => {
    calls.push(args);
    return result;
  });

  assert.equal(await commands.startQuickRequest('Add a test', 'openai/gpt-6-luna'), result);
  assert.deepEqual(calls, [['start_quick_request', { prompt: 'Add a test', model: 'openai/gpt-6-luna' }]]);
});

test('restores the latest session and preserves the serialized result', async () => {
  const result = { sessionId: 'ses_old', title: 'Earlier request' };
  const calls = [];
  const commands = createQuickRequestCommands(async (...args) => {
    calls.push(args);
    return result;
  });

  assert.equal(await commands.restoreLatestQuickRequest(), result);
  assert.deepEqual(calls, [['restore_latest_quick_request']]);
});

test('sets the explicitly selected model before sending the initial prompt', async () => {
  const calls = [];
  const commands = createQuickRequestCommands(async (...args) => {
    calls.push(args);
    return undefined;
  });

  await commands.sendInitialPrompt('ses_123', 'Add a test', 'openai/gpt-6-luna');
  assert.deepEqual(calls, [[
    'send_initial_prompt',
    { sessionId: 'ses_123', prompt: 'Add a test', model: 'openai/gpt-6-luna' },
  ]]);
});

test('preserves Tauri command errors for the UI to report', async () => {
  const error = new Error('Selected model is no longer available');
  const commands = createQuickRequestCommands(async () => {
    throw error;
  });

  await assert.rejects(commands.startQuickRequest('Add a test', 'openai/gpt-6-luna'), (caught) => caught === error);
});
