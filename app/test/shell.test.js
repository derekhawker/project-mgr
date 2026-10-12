import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShellResponse, loadApplicationShell } from '../src/shell.js';

function createShellView() {
  const classes = [];
  return {
    connectionStatus: { textContent: '' },
    connectionIndicator: { classList: { add: (name) => classes.push(name) } },
    commandResult: { textContent: '' },
    appVersion: { textContent: '' },
    classes,
  };
}

test('formats the app-owned Rust shell response for visible UI output', () => {
  assert.equal(
    formatShellResponse({
      appName: 'OpenCode Project Manager',
      version: '0.1.0',
      status: 'ready',
      message: 'The Rust core and management storage are initialized.',
    }),
    'OpenCode Project Manager · ready · The Rust core and management storage are initialized.',
  );
});

test('keeps Rust-reported startup storage failures visible without labeling storage ready', () => {
  const response = formatShellResponse({
    appName: 'OpenCode Project Manager',
    version: '0.1.0',
    status: 'error',
    message:
      'Management storage could not be initialized: migration failed. Management features are unavailable.',
  });

  assert.equal(
    response,
    'OpenCode Project Manager · error · Management storage could not be initialized: migration failed. Management features are unavailable.',
  );
  assert.match(response, /Management features are unavailable/);
  assert.doesNotMatch(response, /storage are initialized/);
});

test('rejects responses that do not match the Rust command contract', () => {
  assert.throws(
    () => formatShellResponse({ appName: 'OpenCode Project Manager' }),
    {
      name: 'TypeError',
      message: 'The Rust core returned an invalid application shell response.',
    },
  );
});

test('invokes app_shell_info without a payload and maps a successful response to the visible shell', async () => {
  const view = createShellView();
  const invocations = [];
  const response = {
    appName: 'OpenCode Project Manager',
    version: '0.1.0',
    status: 'ready',
    message: 'The Rust core and management storage are initialized.',
  };

  await loadApplicationShell({
    invoke: (...args) => {
      invocations.push(args);
      return Promise.resolve(response);
    },
    ...view,
  });

  assert.deepEqual(invocations, [['app_shell_info']]);
  assert.equal(view.commandResult.textContent, formatShellResponse(response));
  assert.equal(view.appVersion.textContent, 'Version 0.1.0');
  assert.equal(view.connectionStatus.textContent, 'Connected to the Rust core');
  assert.deepEqual(view.classes, ['is-connected']);
});

test('shows Rust-reported storage unavailability without treating the core as disconnected', async () => {
  const view = createShellView();
  const invocations = [];
  const response = {
    appName: 'OpenCode Project Manager',
    version: '0.1.0',
    status: 'error',
    message:
      'Management storage could not be initialized: migration failed. Management features are unavailable.',
  };

  await loadApplicationShell({
    invoke: (...args) => {
      invocations.push(args);
      return Promise.resolve(response);
    },
    ...view,
  });

  assert.deepEqual(invocations, [['app_shell_info']]);
  assert.equal(view.commandResult.textContent, formatShellResponse(response));
  assert.equal(view.appVersion.textContent, 'Version 0.1.0');
  assert.equal(
    view.connectionStatus.textContent,
    'Rust core connected; management storage unavailable',
  );
  assert.deepEqual(view.classes, ['has-error']);
});

test('maps a rejected app_shell_info invocation to a visible connection error', async () => {
  const view = createShellView();
  const invocations = [];
  const error = new Error('invoke failed');

  await loadApplicationShell({
    invoke: (...args) => {
      invocations.push(args);
      return Promise.reject(error);
    },
    ...view,
  });

  assert.deepEqual(invocations, [['app_shell_info']]);
  assert.equal(view.connectionStatus.textContent, 'Could not connect to the Rust core');
  assert.equal(view.commandResult.textContent, String(error));
  assert.deepEqual(view.classes, ['has-error']);
});
