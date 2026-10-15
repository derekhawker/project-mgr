import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { bindQuickRequestForm } from '../src/quick-request-form.js';
import { task, session } from './command-fixtures.js';

function createForm(window) {
  window.document.body.innerHTML = `
    <form id="quick-request-form">
      <textarea id="quick-prompt"></textarea>
      <select id="quick-model"><option value='{"providerId":"openai","id":"gpt-test"}'>Test model</option></select>
      <button id="quick-submit" type="submit">Start Quick Request</button>
      <p id="quick-error"></p>
    </form>`;
  const document = window.document;
  return {
    form: document.querySelector('#quick-request-form'),
    promptInput: document.querySelector('#quick-prompt'),
    modelSelect: document.querySelector('#quick-model'),
    submitButton: document.querySelector('#quick-submit'),
    errorMessage: document.querySelector('#quick-error'),
  };
}

test('rendered Quick Request form submits through the production command boundary without resetting other UI state', async () => {
  const window = new Window();
  const controls = createForm(window);
  controls.promptInput.value = 'Keep my request context';
  const calls = [];
  const order = [];
  const request = {
    task: { ...task, id: 'quick-dom-1', quickRequest: null },
    session: { ...session, openCodeSessionId: 'session-dom-1' },
    prompt: 'Keep my request context',
  };
  const invoke = async (name, payload) => {
    calls.push([name, payload]);
    if (name === 'quick_request_create') return request;
    if (name === 'quick_request_start_prompt') return null;
    throw new Error(`Unexpected Tauri command: ${name}`);
  };
  const controller = bindQuickRequestForm({
    ...controls,
    invoke,
    isReady: () => true,
    waitForTerminal: async () => order.push('terminal-ready'),
    showSession: async (id) => order.push(`show:${id}`),
    refreshRequests: async () => order.push('refresh-list'),
  });

  controls.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await controller.whenSettled();

  assert.deepEqual(order, ['terminal-ready', 'show:session-dom-1', 'refresh-list']);
  assert.deepEqual(calls, [
    ['quick_request_create', {
      prompt: 'Keep my request context',
      model: { providerId: 'openai', id: 'gpt-test' },
      repositoryId: null,
    }],
    ['quick_request_start_prompt', {
      requestId: 'quick-dom-1',
      model: { providerId: 'openai', id: 'gpt-test' },
    }],
  ]);
  assert.equal(controls.promptInput.value, '');
  assert.equal(controls.modelSelect.value, '{"providerId":"openai","id":"gpt-test"}');
  assert.equal(controls.errorMessage.textContent, '');
  assert.equal(controls.submitButton.disabled, false);
  window.happyDOM.abort();
});

test('rendered Quick Request form retains the prompt and shows the boundary error on failed startup', async () => {
  const window = new Window();
  const controls = createForm(window);
  controls.promptInput.value = 'Do not lose this on failure';
  const calls = [];
  const controller = bindQuickRequestForm({
    ...controls,
    invoke: async (name) => {
      calls.push(name);
      if (name === 'quick_request_create') return {
        task: { ...task, id: 'quick-dom-2', quickRequest: null },
        session: { ...session, openCodeSessionId: 'session-dom-2' },
        prompt: 'Do not lose this on failure',
      };
      throw new Error('OpenCode rejected the initial prompt');
    },
    isReady: () => true,
    waitForTerminal: async () => {},
    showSession: async () => {},
    refreshRequests: async () => assert.fail('failed startup must not refresh the request list'),
  });

  controls.form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await controller.whenSettled();

  assert.deepEqual(calls, ['quick_request_create', 'quick_request_start_prompt']);
  assert.equal(controls.promptInput.value, 'Do not lose this on failure');
  assert.match(controls.errorMessage.textContent, /OpenCode rejected the initial prompt/);
  assert.equal(controls.submitButton.disabled, false);
  window.happyDOM.abort();
});
