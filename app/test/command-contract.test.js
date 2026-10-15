import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { COMMAND_CONTRACT, COMMAND_NAMES, invokeCommand } from '../src/command-contract.js';
import { resultForCommand } from './command-fixtures.js';

const root = join(process.cwd(), 'src-tauri', 'src', 'lib.rs');
const rust = readFileSync(root, 'utf8');
const handler = rust.match(/generate_handler!\s*\[([\s\S]*?)\]\)/)?.[1] || '';
const rustCommands = [...handler.matchAll(/\b([a-z][a-z0-9_]*)\s*,?/g)].map((match) => match[1]);
const rustAttributes = [...rust.matchAll(/#\[tauri::command(?:\([^]]*\))?\]\s*(?:pub\s+)?fn\s+([a-z][a-z0-9_]*)/g)].map((match) => match[1]);
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

test('checked-in command inventory has one contract for every registered Rust command', () => {
  assert.deepEqual([...COMMAND_NAMES].sort(), [...rustCommands].sort());
  assert.deepEqual([...COMMAND_NAMES].sort(), [...rustAttributes].sort());
  assert.equal(COMMAND_NAMES.length, 57);
});

test('production main-screen selectors resolve to rendered HTML elements', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  const referencedIds = [...main.matchAll(/querySelector\(['"]#([a-zA-Z0-9_-]+)/g)].map((match) => match[1]);
  const renderedIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...new Set(referencedIds)].filter((id) => !renderedIds.has(id)), []);
});

test('New-work is a modal over the existing workbench, with no standalone workspace creation path', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(html, /<dialog id="new-work-dialog"[\s\S]*id="new-work"[\s\S]*id="new-work-review"[\s\S]*<\/dialog>/);
  assert.doesNotMatch(html, /id="new-workspace"|id="workspace-create-form"|id="empty-workspaces"/);
  assert.match(main, /newWorkDialog\.showModal\(\)/);
  assert.doesNotMatch(main, /restoreWorkspacePendingPrompt/, 'selecting a workspace must not restore the unsent starting-prompt editor');
  assert.match(html, /Select a workspace or task, or choose New work to start\./);
  assert.match(html, /class="new-work-dialog-scroll"[\s\S]*class="new-work-dialog-footer"/);
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
  assert.match(css, /\.workspace-dialog-content\s*\{[^}]*padding:\s*1\.5rem/);
  assert.match(css, /\.new-work-dialog-scroll\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.new-work-dialog-footer\s*\{[^}]*flex:\s*0\s+0\s+auto/);
});

test('workspace and task confirmation attach the tracked terminal before automatically sending the reviewed prompt', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(main, /await showSession\(task\.setupSessionId\);\s*await submitNewWorkStartingPrompt\(invoke, taskPromptAction, startingPrompt\);/);
  assert.match(main, /await showSession\(initialized\.session\.openCodeSessionId\);[\s\S]*await submitNewWorkStartingPrompt\(invoke, workspacePromptAction, startingPrompt\);/);
  assert.match(main, /selectedModel,\s*currentProposal\.task\.name,\s*currentProposal\.task\.intent/);
});

test('stateful hidden panels cannot be forced visible by component display styles', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('terminal card contains only the terminal viewport and has no surrounding inset', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  const terminalCard = html.match(/<section class="terminal-card"[^>]*>([\s\S]*?)<\/section>/)?.[1] || '';
  assert.match(terminalCard, /^\s*<div id="terminal-views" class="terminal-views"><\/div>\s*$/);
  assert.match(main, /const sessionStatus\s*=\s*document\.querySelector\('#session-status'\)/);
  assert.match(main, /const pendingInputs\s*=\s*document\.querySelector\('#pending-inputs'\)/);
  assert.match(html, /<nav id="session-tabs"[\s\S]*?<button id="terminal-fullscreen"[^>]*>/);
  assert.match(css, /\.terminal-card\s*\{[^}]*\}/);
  const cardRules = css.match(/\.terminal-card\s*\{([^}]*)\}/)?.[1] || '';
  assert.doesNotMatch(cardRules, /padding|margin|background|border-radius/);
  assert.match(css, /\.right-content\.owner-active\s*\{[^}]*padding:\s*0/);
  assert.match(css, /\.terminal-views\s*\{[^}]*display:\s*flex/);
  assert.match(css, /#selected-owner\s*\{[^}]*flex:\s*1\s+1\s+0/);
});

test('tracked terminal tabs are labeled OpenCode instead of inheriting the owner name', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(main, /function sessionTabLabel\(proposal = false\)\s*\{\s*if \(proposal\) return 'Proposal';\s*return 'OpenCode';\s*\}/);
});

test('boundary catches the historical flat quick-request payload before Tauri', async () => {
  let sent = false;
  await assert.rejects(
    () => invokeCommand(async () => { sent = true; }, 'quick_request_list', { history: true }),
    /unknown field|missing request/,
  );
  assert.equal(sent, false);
  await assert.doesNotReject(() => invokeCommand(async (name, payload) => {
    assert.equal(name, 'quick_request_list');
    assert.deepEqual(payload, { request: { history: true } });
    return [];
  }, 'quick_request_list', { request: { history: true }}));
});

test('production frontend has no raw invoke call outside the boundary module', () => {
  const files = readdirSync(join(process.cwd(), 'src')).filter((name) => name.endsWith('.js') && name !== 'command-contract.js');
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), 'src', file), 'utf8');
    assert.doesNotMatch(source, /@tauri-apps\/api\/core|\b(?:import|export)\s*\{[^}]*\binvoke\b|\b(?:import|export)\s*\*\s+as\s+\w+\s+from\s+['"]@tauri-apps\/api\/core|\b(?:const|let|var)\s+\w+\s*=\s*invoke\b|\b(?:window|globalThis|global)\.invoke\s*\(|\binvoke\s*\(/, `${file} contains a direct Tauri invoke`);
  }
});

test('frontend command adapters only name commands present in the inventory', () => {
  const files = readdirSync(join(process.cwd(), 'src')).filter((name) => name.endsWith('.js'));
  const names = new Set();
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), 'src', file), 'utf8');
    for (const match of source.matchAll(/invokeCommand\([^,]+,\s*['"]([a-z][a-z0-9_]*)['"]/g)) names.add(match[1]);
  }
  for (const name of names) assert.ok(COMMAND_NAMES.includes(name), `frontend adapter uses unlisted command ${name}`);
  assert.deepEqual([...names].sort(), [...COMMAND_NAMES].sort(), 'frontend adapters must exactly cover the Rust command inventory');
});

test('every manifest entry has executable payload and result rules', () => {
  for (const name of COMMAND_NAMES) {
    assert.ok(COMMAND_CONTRACT[name].payload);
    assert.ok(COMMAND_CONTRACT[name].result);
  }
});

test('contracts leave opaque JSON only at explicitly reviewed protocol/form seams', () => {
  const opaqueJsonPaths = new Set([
    'opencode_form_reply.payload.properties.request.properties.answer',
    'opencode_session_history.result.properties.data.items',
    'opencode_session_reconcile.result.properties.history.properties.data.items',
    'opencode_session_reconcile.result.properties.permissions.items',
    'opencode_session_reconcile.result.properties.forms.items',
    'opencode_session_reconcile.result.properties.durableEvents.items',
    'opencode_pending_inputs.result.properties.permissions.items',
    'opencode_pending_inputs.result.properties.forms.items',
    'opencode_pending_inputs_all.result.items.properties.permissions.items',
    'opencode_pending_inputs_all.result.items.properties.forms.items',
    'opencode_session_pending_inputs.result.properties.permissions.items',
    'opencode_session_pending_inputs.result.properties.forms.items',
  ]);
  const visit = (command, value, path) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'json') {
      assert.ok(opaqueJsonPaths.has(path), `unreviewed opaque contract path: ${path}`);
    }
    if (value.type === 'object') {
      assert.ok(value.properties || value.additionalProperties === true, `object lacks fields at ${path}`);
    }
    for (const [key, child] of Object.entries(value)) visit(command, child, `${path}.${key}`);
  };
  for (const [name, spec] of Object.entries(COMMAND_CONTRACT)) {
    visit(name, spec.payload, `${name}.payload`);
    visit(name, spec.result, `${name}.result`);
  }
});

test('recursive validation rejects missing, null, nested, and unknown values', async () => {
  const validModel = { providerId: 'openai', id: 'gpt' };
  await assert.rejects(() => invokeCommand(() => null, 'quick_request_create', {
    request: { prompt: 'hello', model: validModel, extra: true },
  }), /unknown field/);
  await assert.rejects(() => invokeCommand(() => null, 'quick_request_create', {
    request: { prompt: null, model: validModel },
  }), /prompt must not be null/);
  await assert.rejects(() => invokeCommand(() => null, 'quick_request_create', {
    request: { prompt: 'hello', model: { providerId: 'openai', id: 3 } },
  }), /model\.id must be string/);
  await assert.rejects(() => invokeCommand(() => null, 'quick_request_create', {
    request: { model: validModel },
  }), /missing prompt/);
});

test('result validation is recursive and errors retain command identity', async () => {
  const valid = { appName: 'app', version: '1', status: 'ready', message: 'ok' };
  assert.deepEqual(await invokeCommand(() => valid, 'app_shell_info'), valid);
  await assert.rejects(() => invokeCommand(() => ({ ...valid, extra: true }), 'app_shell_info'), (error) => {
    assert.equal(error.command, 'app_shell_info');
    return /unknown field/.test(error.message);
  });
  await assert.rejects(() => invokeCommand(() => ({ ...valid, version: null }), 'app_shell_info'), /version must not be null/);
  await assert.rejects(() => invokeCommand(() => 'not-an-object', 'app_shell_info'), /result must be object/);
  await assert.rejects(() => invokeCommand(() => { throw 'boom'; }, 'app_shell_info'), (error) => {
    assert.equal(error.command, 'app_shell_info');
    return error.message === 'Tauri command app_shell_info failed: boom';
  });
});

test('command tagging and nested quick-request shape are enforced', async () => {
  await assert.rejects(() => invokeCommand(() => [], 'quick_request_list', { history: true }), /unknown field|missing request/);
  await assert.rejects(() => invokeCommand(() => [], 'quick_request_list', { request: { history: 'yes' } }), /history must be boolean/);
  await assert.rejects(() => invokeCommand(() => [], 'quick_request_list', { request: { history: true, extra: false } }), /unknown field/);
});

test('preflight payload failures retain the command name before transport', async () => {
  await assert.rejects(
    () => invokeCommand(() => { throw new Error('must not send'); }, 'opencode_session_status', { sessionId: 'ses-1', extra: true }),
    (error) => error.command === 'opencode_session_status' && /unknown field/.test(error.message),
  );
  await assert.rejects(
    () => invokeCommand(() => null, 'opencode_session_status', { sessionId: 7 }),
    (error) => error.command === 'opencode_session_status' && /must be string/.test(error.message),
  );
});

test('task creation sends only task metadata and confirmed repository context, never prompt text', async () => {
  let sent = false;
  await assert.doesNotReject(() => invokeCommand(async () => {
    sent = true;
    return resultForCommand('task_create');
  }, 'task_create', {
    request: {
      workspaceId: 'workspace-1',
      model: { providerId: 'openai', id: 'gpt-6-luna' },
      name: 'Parser fix',
      description: 'Update the parser',
      repositoryIds: [],
    },
  }));
  assert.equal(sent, true);

  sent = false;
  await assert.rejects(() => invokeCommand(async () => {
    sent = true;
  }, 'task_create', {
    request: {
      workspaceId: 'workspace-1',
      model: { providerId: 'openai', id: 'gpt-6-luna', unexpected: true },
      name: 'Parser fix',
      repositoryIds: [],
    },
  }), /unknown field/);
  assert.equal(sent, false);
  await assert.rejects(() => invokeCommand(() => null, 'task_create', {
    request: {
      workspaceId: 'workspace-1', prompt: 'Do not persist me',
      model: { providerId: 'openai', id: 'gpt-6-luna' }, name: 'Parser fix', repositoryIds: [],
    },
  }), /unknown field/);
});
