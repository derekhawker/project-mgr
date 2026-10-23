import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { listRepositoryTools, renderRepositoryTools, repoToolTerminalCommand, startRepositoryTool, startWorkbenchShell, launchWorkbenchOsHandoff } from '../src/repo-tools-ui.js';

const groups = [
  { repositoryId: 'r1', name: 'Alpha', path: '/workspace/repos/alpha', packageScripts: ['build', 'test'], makeTargets: ['check'], npmInstallNeeded: true },
  { repositoryId: 'r2', name: 'Beta', path: '/workspace/repos/beta', packageScripts: [], makeTargets: ['lint'], npmInstallNeeded: false },
];

test('repository tool commands carry the selected owner/repository and reject invalid results', async () => {
  const calls = [];
  const invoke = async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'repo_tools_list') return groups;
    if (name === 'repo_tool_terminal_start') return { terminalId: 'tool-1', label: 'make check', directory: '/worktree/alpha' };
    return null;
  };
  assert.deepEqual(await listRepositoryTools(invoke, 'task', 'task-1'), groups);
  assert.deepEqual(await startRepositoryTool(invoke, 'task', 'task-1', 'r1', 'make_target', 'check'), {
    terminalId: 'tool-1', label: 'make check', directory: '/worktree/alpha',
  });
  await repoToolTerminalCommand(invoke, 'write', { terminalId: 'tool-1', data: 'y\n' });
  assert.deepEqual(calls.map(({ name }) => name), ['repo_tools_list', 'repo_tool_terminal_start', 'repo_tool_terminal_write']);
  assert.deepEqual(calls[1].payload, { request: { ownerType: 'task', ownerId: 'task-1', repositoryId: 'r1', kind: 'make_target', name: 'check' } });
  await assert.rejects(() => startRepositoryTool(async () => ({ ...groups[0], extra: true }), 'workspace', 'w1', 'r1', 'npm_script', 'test'), /unknown field/);
});

test('Tools displays repository groups, all named targets/scripts, and starts the automatic install hook', () => {
  const window = new Window();
  globalThis.document = window.document;
  const menu = window.document.createElement('div');
  let install;
  const calls = [];
  renderRepositoryTools(menu, groups, {
    onRun: (_repository, kind, name) => calls.push(`${kind}:${name}`),
    onInstall: (repository) => { install = repository.repositoryId; },
  });
  assert.equal(menu.querySelectorAll('.repo-tools-group').length, 2);
  assert.equal(menu.querySelectorAll('.repo-tools-path').length, 0);
  assert.match(menu.querySelector('.repo-tools-group h2').textContent, /^Alpha$/);
  assert.match(menu.textContent, /build/);
  assert.match(menu.textContent, /test/);
  assert.match(menu.textContent, /check/);
  assert.equal(install, 'r1');
  [...menu.querySelectorAll('button')].find((button) => button.textContent === 'test').click();
  assert.deepEqual(calls, ['npm_script:test']);
  window.close();
  delete globalThis.document;
});

test('Tools shows owner handoff actions before repositories, including for repository-free owners', () => {
  const window = new Window();
  globalThis.document = window.document;
  const menu = window.document.createElement('div');
  const calls = [];
  renderRepositoryTools(menu, [], { onHandoff: (action) => calls.push(action) });
  assert.deepEqual([...menu.querySelectorAll('.repo-tools-handoff button')].map((button) => button.textContent), [
    'Open terminal', 'Open in IntelliJ', 'Show in folder',
  ]);
  assert.ok(menu.querySelector('.repo-tools-handoff').compareDocumentPosition(menu.querySelector('p')) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  menu.querySelector('.repo-tools-handoff button').click();
  assert.deepEqual(calls, ['shell']);
  window.close();
  delete globalThis.document;
});

test('Workbench handoff commands send owner identity and strictly validate their contracts', async () => {
  const calls = [];
  const invoke = async (name, payload) => {
    calls.push({ name, payload });
    if (name === 'workbench_shell_terminal_start') return { terminalId: 'workbench-shell-1', label: 'Terminal', directory: '/workspace' };
    return null;
  };
  assert.deepEqual(await startWorkbenchShell(invoke, 'workspace', 'workspace-1'), {
    terminalId: 'workbench-shell-1', label: 'Terminal', directory: '/workspace',
  });
  await launchWorkbenchOsHandoff(invoke, 'task', 'task-1', 'idea');
  assert.deepEqual(calls, [
    { name: 'workbench_shell_terminal_start', payload: { request: { ownerType: 'workspace', ownerId: 'workspace-1' } } },
    { name: 'workbench_os_handoff', payload: { request: { ownerType: 'task', ownerId: 'task-1', action: 'idea' } } },
  ]);
  await assert.rejects(() => launchWorkbenchOsHandoff(async () => ({ unexpected: true }), 'workspace', 'workspace-1', 'folder'), /result must be null/);
});
