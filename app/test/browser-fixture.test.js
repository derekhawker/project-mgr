import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invokeBrowserFixture } from '../src/browser-fixture.js';
import { createQuickRequest, deleteQuickRequest, listQuickRequests, resolveQuickRequestDirectory, restoreQuickRequest, startQuickRequestPrompt } from '../src/shell.js';
import { invokeCommand } from '../src/command-contract.js';

test('browser fixture is deterministic, isolated, and blocks unimplemented effects without logging payloads', async () => {
  const first = await invokeBrowserFixture('workspace_navigation');
  first.workspaces[0].name = 'changed';
  assert.equal((await invokeBrowserFixture('workspace_navigation')).workspaces[0].name, 'Example Workspace');
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(line);
  try {
    await assert.rejects(invokeBrowserFixture('workbench_os_handoff', { prompt: 'private sentinel' }), /no live action/);
    assert.deepEqual(lines, ['[browser fixture] blocked unsupported command: workbench_os_handoff']);
  } finally { console.error = original; }
});

test('Quick Request fixture preserves exact in-memory prompt and session through create, start, restore and delete', async () => {
  const invoke = invokeBrowserFixture;
  const model = { providerId: 'fixture', id: 'model' };
  const prompt = ' private fixture prompt \n';
  assert.equal(await resolveQuickRequestDirectory(invoke, null), '/fixture/Quick Requests');
  assert.equal(await resolveQuickRequestDirectory(invoke, 'fixture-repo'), '/fixture/repository');
  const before = await listQuickRequests(invoke);
  await assert.rejects(createQuickRequest(invoke, prompt, model, 'unknown'), /Unknown fixture repository/);
  assert.deepEqual(await listQuickRequests(invoke), before);
  await assert.rejects(startQuickRequestPrompt(invoke, 'missing', model), /Unknown fixture Quick Request/);
  const record = await createQuickRequest(invoke, prompt, model, 'fixture-repo');
  const other = await createQuickRequest(invoke, 'Another fixture', model, null);
  assert.equal(record.prompt, prompt);
  assert.equal(record.session.directory, '/fixture/repository');
  assert.equal(record.session.owner.owner_id, record.task.id);
  await startQuickRequestPrompt(invoke, record.task.id, model);
  assert.deepEqual(await restoreQuickRequest(invoke, record.task.id), record);
  assert.equal((await listQuickRequests(invoke, true)).find((entry) => entry.task.id === record.task.id).prompt, prompt);
  assert.equal((await invokeCommand(invoke, 'opencode_session_restore', { sessionId: record.session.openCodeSessionId })).directory, '/fixture/repository');
  assert.equal((await invokeCommand(invoke, 'opencode_terminal_replay', { sessionId: record.session.openCodeSessionId })).replay.length, 1);
  await deleteQuickRequest(invoke, record.task.id);
  assert.equal((await restoreQuickRequest(invoke, other.task.id)).prompt, 'Another fixture');
  await deleteQuickRequest(invoke, other.task.id);
  assert.deepEqual(await listQuickRequests(invoke, true), before);
  await assert.rejects(restoreQuickRequest(invoke, record.task.id), /Unknown fixture Quick Request/);
  await assert.rejects(invokeCommand(invoke, 'opencode_session_restore', { sessionId: record.session.openCodeSessionId }), /Unknown fixture session/);
});

test('fixture creates and reopens a workspace and tool without external operations', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('unexpected network'); };
  try {
    const created = await invokeBrowserFixture('workspace_create_initialized', { request: { name: 'Fixture created' } });
    assert.equal(created.workspace.name, 'Fixture created');
    assert.equal((await invokeBrowserFixture('workspace_navigation')).workspaces.at(-1).id, created.workspace.id);
    assert.deepEqual(await invokeBrowserFixture('opencode_session_restore', { sessionId: created.sessions[0].openCodeSessionId }), created.sessions[0]);
    const tools = await invokeBrowserFixture('repo_tools_list', { request: { ownerId: 'fixture-workspace' } });
    assert.deepEqual(tools[0].packageScripts, ['test']);
    assert.deepEqual(await invokeBrowserFixture('repo_tools_list', { request: { ownerId: created.workspace.id } }), []);
    const tool = await invokeBrowserFixture('repo_tool_terminal_start', { request: { name: 'test' } });
    assert.match(tool.terminalId, /^fixture-tool-/);
    assert.equal((await invokeBrowserFixture('repo_tool_terminal_replay', { terminalId: tool.terminalId })).replay.length, 1);
  } finally { globalThis.fetch = oldFetch; }
});
