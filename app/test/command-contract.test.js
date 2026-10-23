import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { COMMAND_CONTRACT, COMMAND_NAMES, invokeCommand } from '../src/command-contract.js';
import { resultForCommand } from './command-fixtures.js';

const root = join(process.cwd(), 'src-tauri', 'src', 'lib.rs');
const rust = readFileSync(root, 'utf8');
const management = readFileSync(join(process.cwd(), 'src-tauri', 'src', 'management.rs'), 'utf8');
const handler = rust.match(/generate_handler!\s*\[([\s\S]*?)\]\)/)?.[1] || '';
const rustCommands = [...handler.matchAll(/\b([a-z][a-z0-9_]*)\s*,?/g)].map((match) => match[1]);
const rustAttributes = [...rust.matchAll(/#\[tauri::command(?:\([^]]*\))?\]\s*(?:pub\s+)?fn\s+([a-z][a-z0-9_]*)/g)].map((match) => match[1]);
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

test('checked-in command inventory has one contract for every registered Rust command', () => {
  assert.deepEqual([...COMMAND_NAMES].sort(), [...rustCommands].sort());
  assert.deepEqual([...COMMAND_NAMES].sort(), [...rustAttributes].sort());
  assert.equal(COMMAND_NAMES.length, 72);
});

test('production main-screen selectors resolve to rendered HTML elements', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  const referencedIds = [...main.matchAll(/querySelector\(['"]#([a-zA-Z0-9_-]+)/g)].map((match) => match[1]);
  const renderedIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...new Set(referencedIds)].filter((id) => !renderedIds.has(id)), []);
});

test('workspace creation reports live setup steps and renders error details as text', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(html, /id="new-work-progress"[\s\S]*id="new-work-progress-steps"/);
  assert.match(html, /id="new-work-prompt"[\s\S]*id="new-work-progress"/);
  assert.match(main, /newWorkPrompt\.after\(progressPanel\)/);
  assert.match(main, /progressAnchor\.after\(progressPanel\)/);
  assert.match(main, /listen\('workspace-setup-progress'/);
  assert.match(main, /row\.detail\.querySelector\('pre'\)\.textContent = detail/);
  assert.match(main, /Workspace create[\s\S]*failed/);
});

test('repository directory management is a page opened from top navigation', () => {
  const nav = html.match(/<aside class="navigation"[\s\S]*?<\/aside>/)?.[0] || '';
  assert.match(nav, /id="show-directories"/);
  assert.match(html, /id="directories-page"[\s\S]*id="add-repository-directories"/);
  assert.match(html, /id="directory-list"/);
  assert.doesNotMatch(html, /id="disallowed-repository-list"|id="repository-list"/);
  assert.doesNotMatch(html, /id="scan-path"|id="scan-repositories"/);
});

test('proposal review uses a compact repository path list and has one starting prompt field', () => {
  assert.match(html, /<ul id="proposal-repositories" class="proposal-repository-list"><\/ul>/);
  assert.match(html, /id="workspace-review-name" type="text" required/);
  assert.match(html, /id="workspace-review-directory"/);
  assert.match(html, /<textarea id="workspace-original-prompt" rows="3" readonly><\/textarea>/);
  assert.match(html, /<label for="proposal-prompt">Starting prompt<\/label>/);
  assert.doesNotMatch(html, /proposal-grid/);
  assert.doesNotMatch(html, /Pinned submodules|Workspace clone:/);
});

test('Quick Requests use a dedicated available-height page with a visible way back and no owner controls', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(html, /id="quick-request-list"/);
  assert.match(html, /id="quick-request-full-list"[^>]*hidden/);
  assert.match(html, /id="quick-request-full-items"/);
  assert.match(html, /id="quick-request-back"[^>]*>Back to Quick Requests</);
  assert.match(main, /await listQuickRequests\(invoke, history\)/);
  assert.match(management, /request\.created_at >= recent_cutoff/);
  assert.match(main, /classList\.toggle\('quick-request-terminal-page', isQuickRequest\)/);
  assert.match(main, /workbench\.hidden = isQuickRequest/);
  assert.doesNotMatch(main, /setTerminalFullscreen\(true\)/);
  assert.doesNotMatch(html, /id="new-task"/);
  assert.doesNotMatch(html, /id="new-work-type"/);
  assert.match(html, /id="new-work-menu"[\s\S]*data-new-work-type="quick_request"/);
  assert.match(html, /id="new-quick-request"[^>]*>New Quick Request</);
  assert.match(main, /window\.confirm\('Delete this Quick Request from the app\?/);
  assert.match(main, /item\.append\(button\);\s*if \(history\)[\s\S]*?item\.append\(remove\)/);
  assert.doesNotMatch(main, /item\.append\(.*dismiss|item\.append\(.*promote|item\.append\(.*retry/);
});

test('Quick Request navigation aligns its compact All button with the heading and omits Delete', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(html, /<div class="quick-section-heading">\s*<h3>Quick Requests<\/h3>\s*<button id="show-history"/);
  assert.match(html, /id="show-history"[^>]*aria-label="See all Quick Requests"[^>]*>[\s\S]*?<span>All<\/span>/);
  assert.match(html, /id="quick-request-full-list"[\s\S]*<h1 id="quick-request-full-title"[\s\S]*id="new-quick-request"/);
  assert.doesNotMatch(html, /id="back-from-quick-requests"/);
  assert.doesNotMatch(html, /id="history-disabled"/);
  assert.match(main, /item\.append\(button\);\s*if \(history\)[\s\S]*?item\.append\(remove\)/);
  assert.doesNotMatch(main, /item\.append\(button, remove\)/);
  assert.match(main, /item\.className = 'quick-request-navigation-item'/);
});

test('New-work is a modal over the existing workbench, with no standalone workspace creation path', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(html, /<dialog id="new-work-dialog"[\s\S]*id="new-work"[\s\S]*id="new-work-review"[\s\S]*<\/dialog>/);
  assert.doesNotMatch(html, /id="new-workspace"|id="workspace-create-form"|id="empty-workspaces"/);
  assert.match(main, /newWorkDialog\.showModal\(\)/);
  assert.match(html, /id="new-work-menu"[\s\S]*data-new-work-type="workspace"[\s\S]*data-new-work-type="quick_request"/);
  assert.doesNotMatch(html, /<select id="new-work-type"/);
  assert.match(html, /id="new-work-title">New Workspace</);
  assert.match(html, /id="new-work-prompt-label"[^>]*>Original prompt</);
  assert.match(main, /workspace: \['Workspace',[\s\S]*task: \['Task',[\s\S]*quick_request: \['Quick Request'/);
  assert.match(main, /proposalCreate\.textContent = proposal\.workType === 'quick_request'[\s\S]*Create \$\{workTypeName\}/);
  assert.match(main, /requestedType,\s*\n\s*\);/);
  assert.match(html, /id="quick-request-directory"/);
  assert.match(main, /originalPrompt,\s*\n\s*model: selectedModel,\s*\n\s*repositoryId: selectedRepositoryId/);
  assert.match(main, /requestedNewWorkType = workType/);
  assert.doesNotMatch(main, /restoreWorkspacePendingPrompt/, 'selecting a workspace must not restore the unsent starting-prompt editor');
  assert.match(html, /Select a workspace or task, or choose New work to start\./);
  assert.match(html, /class="new-work-dialog-scroll"[\s\S]*class="new-work-dialog-footer"/);
});

test('Task creation has a Workspace selector for both navigation and Workspace context-menu entry points', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(html, /id="workspace-context-menu"[^>]*role="menu"[\s\S]*id="workspace-context-new-task"[^>]*role="menuitem"/);
  assert.match(html, /id="task-workspace-field"[^>]*hidden[\s\S]*label for="task-workspace-select"[^>]*>Workspace<\/label><select id="task-workspace-select" required>/);
  assert.match(html, /data-new-work-type="task"/);
  assert.match(main, /createWorkspaceNavigationButton\(document, workspace, \{[\s\S]*onContextMenu: openWorkspaceContextMenu/);
  assert.match(main, /if \(workspace\) openNewWork\('task', workspace\.id\)/);
  assert.match(main, /if \(workType === 'task'\) populateTaskWorkspace\(workspaceId\)/);
  assert.match(main, /runNewWorkProposal\([\s\S]*requestedType === 'task' \? newWorkWorkspaceContext/);
});

test('Task proposal review shows editable creation details and optional revised prompt without sending it', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(html, /id="task-review-details"[^>]*class="workspace-review-form"[^>]*hidden/);
  assert.match(html, /id="task-review-name" type="text" required/);
  assert.match(html, /id="task-review-intent" rows="3" required/);
  assert.match(html, /id="task-review-workspace"/);
  assert.match(html, /id="task-review-directory"/);
  assert.match(html, /id="task-original-prompt" rows="3" readonly/);
  assert.match(html, /label for="task-revised-prompt">Revised prompt \(optional\)/);
  assert.match(html, /not sent to Task sessions or saved/);
  assert.match(main, /task-review-name'\)\.value = proposal\.task\?\.name/);
  assert.match(main, /task-revised-prompt'\)\.value = proposal\.startingPrompt \|\| ''/);
  assert.match(main, /createWorkspaceTask\([\s\S]*taskName,[\s\S]*taskIntent,[\s\S]*currentProposal\.repositories\.map/);
  assert.doesNotMatch(main.match(/else if \(currentProposal\.workType === 'task'\) \{([\s\S]*?)\n    \} else \{/i)?.[1] || '', /task-revised-prompt|submitNewWorkStartingPrompt/);
});

test('active Task does not show routine ready status or let it overwrite terminal errors', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(main, /const setupNotice = taskSetupStatusNotice\(status\)/);
  assert.match(main, /if \(setupNotice\) \{[\s\S]*workspaceStatus\.textContent = setupNotice/);
  assert.match(main, /workspaceStatus\.textContent === currentTaskSetupNotice/);
  assert.doesNotMatch(main, /workspaceStatus\.textContent = formatTaskSetupStatus\(status\)/);
  assert.match(main, /workspaceStatus\.textContent = failed\.length[\s\S]*: '';/);
});

test('workspace confirmation sends its reviewed prompt, while optional Task revised prompt stays unsent', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(main, /const task = created\.task;[\s\S]*created\.sessions\[0\]\.openCodeSessionId/);
  assert.doesNotMatch(main, /submitNewWorkStartingPrompt\(invoke, taskPromptAction/);
  assert.match(main, /for \(const session of workspaceSessions\) await showSession\(session\.openCodeSessionId\);[\s\S]*if \(!multiRepositoryWorkspace && shouldSubmitWorkspaceStartingPrompt\(startingPrompt\)\)[\s\S]*await submitNewWorkStartingPrompt\(invoke, workspacePromptAction, startingPrompt\);[\s\S]*No starting prompt was provided/);
  assert.match(main, /initialized\.sessions \|\| \[\]/);
  assert.match(main, /selectedModel,\s*taskName,\s*taskIntent/);
  assert.match(main, /task-revised-prompt'\)\.value = proposal\.startingPrompt \|\| ''/);
  assert.doesNotMatch(main.match(/else if \(currentProposal\.workType === 'task'\) \{([\s\S]*?)\n    \} else \{/i)?.[1] || '', /task-revised-prompt|submitNewWorkStartingPrompt/);
  assert.match(html, /id="proposal-starting-prompt"/);
  assert.match(main, /proposal-starting-prompt'\)\.hidden = proposal\.workType !== 'workspace'/);
});

test('terminal card contains only the terminal viewport and has no surrounding inset', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  const terminalCard = html.match(/<section class="terminal-card"[^>]*>([\s\S]*?)<\/section>/)?.[1] || '';
  assert.match(terminalCard, /^\s*<div id="terminal-views" class="terminal-views"><\/div>\s*$/);
  assert.match(main, /const sessionStatus\s*=\s*document\.querySelector\('#session-status'\)/);
  assert.match(main, /const pendingInputs\s*=\s*document\.querySelector\('#pending-inputs'\)/);
  assert.doesNotMatch(html, /fullscreen/i);
  assert.doesNotMatch(main, /setTerminalFullscreen|terminal-fullscreen/);
});

test('workspace terminal tabs identify their repository while other sessions use OpenCode', () => {
  const main = readFileSync(join(process.cwd(), 'src', 'main.js'), 'utf8');
  assert.match(main, /function sessionTabLabel\(proposal = false, session = null\)/);
  assert.match(main, /return repository\?\.name \|\| binding\.repositoryId/);
  assert.match(main, /return 'OpenCode'/);
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
    request: { prompt: null, model: validModel, repositoryId: null },
  }), /prompt must not be null/);
  await assert.rejects(() => invokeCommand(() => null, 'quick_request_create', {
    request: { prompt: 'hello', model: { providerId: 'openai', id: 3 }, repositoryId: null },
  }), /model\.id must be string/);
  await assert.rejects(() => invokeCommand(() => null, 'quick_request_create', {
    request: { model: validModel, repositoryId: null },
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
