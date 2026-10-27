import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignal } from 'solid-js';
import { createRepositoryToolsActionForwarders, createRepositoryToolsController } from '../src/repository-tools-controller.js';
const vi = { fn: (impl = () => {}) => { const f = (...args) => { f.calls.push(args); return impl(...args); }; f.calls = []; f.mockResolvedValue = (v) => { impl = () => Promise.resolve(v); return f; }; f.mockRejectedValue = (v) => { impl = () => Promise.reject(v); return f; }; f.mockResolvedValueOnce = (v) => { let once = true; const prior = impl; impl = (...args) => { if (once) { once = false; return Promise.resolve(v); } return prior(...args); }; return f; }; return f; } };

function setup(overrides = {}) {
  let owner = { type: 'workspace', id: 'w1' }, open = false;
  const state = { disabled: false, groups: null, error: null, actions: null };
  const deps = {
    invoke: vi.fn(), listRepositoryTools: vi.fn().mockResolvedValue(['group']),
    getOwner: () => owner, isOpen: () => open,
    setOpen: (v) => { open = v; }, setDisabled: (v) => { state.disabled = v; },
    setGroups: (v) => { state.groups = v; }, setError: (v) => { state.error = v; },
    setActions: (v) => { state.actions = v; },
    openRepositoryToolTerminal: vi.fn().mockResolvedValue(true),
    openWorkbenchShellTerminal: vi.fn().mockResolvedValue(true),
    launchWorkbenchOsHandoff: vi.fn().mockResolvedValue(), installStarted: new Set(),
    ...overrides,
  };
  const ctl = createRepositoryToolsController(deps);
  return { ctl, deps, state, setOwner: (v) => { owner = v; }, setOpen: (v) => { open = v; } };
}
const view = () => ({ setDisabled: vi.fn(), setHidden: vi.fn(), setStatus: vi.fn() });

test('repository tools controller closes without loading; does nothing without an owner', async () => {
    const a = setup(); a.setOpen(true); await a.ctl.toggleRepositoryTools();
    assert.equal(a.state.disabled, false); assert.equal(a.deps.listRepositoryTools.calls.length, 0);
    const b = setup({ getOwner: () => null }); await b.ctl.toggleRepositoryTools();
    assert.equal(b.state.disabled, false);
});
test('repository tools controller loads groups/errors and clears disabled', async () => {
    const a = setup(); await a.ctl.toggleRepositoryTools();
    assert.deepEqual(a.state.groups, ['group']); assert.equal(a.state.error, ''); assert.equal(a.state.disabled, false);
    const b = setup({ listRepositoryTools: vi.fn().mockRejectedValue('oops') }); await b.ctl.toggleRepositoryTools();
    assert.equal(b.state.error, 'Could not load repository tools: oops'); assert.equal(b.state.disabled, false);
});
test('repository tools controller ignores stale owner identity', async () => {
    for (const nextOwner of [null, { type: 'workspace', id: 'w2' }, { type: 'task', id: 'w1' }]) {
      let resolve; const a = setup({ listRepositoryTools: () => new Promise((r) => { resolve = r; }) });
      const pending = a.ctl.toggleRepositoryTools(); a.setOwner(nextOwner); resolve(['old']); await pending;
      assert.equal(a.state.groups, null); assert.equal(a.state.actions, null); assert.equal(a.state.disabled, false);
    }
});
test('repository tools controller preserves handoff/install semantics', async () => {
    const a = setup({ launchWorkbenchOsHandoff: vi.fn().mockRejectedValue('denied') }); await a.ctl.toggleRepositoryTools();
    const v = view(); await a.state.actions.onHandoff('folder', v);
    assert.equal(v.setStatus.calls.at(-1)[0], 'Could not open: denied'); assert.equal(v.setDisabled.calls.at(-1)[0], false);
    const repo = { repositoryId: 'r', path: '/repo' }, installView = view();
    a.deps.openRepositoryToolTerminal.mockResolvedValueOnce(false);
    await a.state.actions.onInstall(repo, installView);
    assert.equal(installView.setStatus.calls.at(-1)[0], 'Could not start npm install; see the terminal error.');
    assert.equal(a.deps.installStarted.size, 0);
    await a.state.actions.onInstall(repo, installView);
    assert.equal(a.deps.openRepositoryToolTerminal.calls.length, 2);
    assert.equal(installView.setStatus.calls.at(-1)[0], 'npm install opened in an interactive terminal.');
    const d = setup(); await d.ctl.toggleRepositoryTools(); const iv = view();
    d.deps.installStarted.add('workspace:w1:r:/repo'); await d.state.actions.onInstall(repo, iv);
    assert.equal(iv.setStatus.calls.at(-1)[0], 'npm install is already running.');
});

test('stable menu callbacks forward arguments, results and errors to the latest action signal', async () => {
  const initial = { onRun: vi.fn(), onInstall: vi.fn(), onHandoff: vi.fn() };
  const [actions, setActions] = createSignal(initial);
  const menu = createRepositoryToolsActionForwarders(actions);
  menu.onRun('initial');
  assert.deepEqual(initial.onRun.calls, [['initial']]);
  const run = menu.onRun, install = menu.onInstall, handoff = menu.onHandoff;
  const current = {
    onRun: vi.fn(() => 'run result'),
    onInstall: vi.fn(async () => 'install result'),
    onHandoff: vi.fn(async () => { throw new Error('handoff failed'); }),
  };
  setActions(current);
  const repo = {}, v = view();
  assert.equal(menu.onRun(repo, 'make_target', 'check'), 'run result');
  assert.equal(await menu.onInstall(repo, v), 'install result');
  await assert.rejects(menu.onHandoff('folder', v), /handoff failed/);
  assert.deepEqual(current.onRun.calls, [[repo, 'make_target', 'check']]);
  assert.deepEqual(current.onInstall.calls, [[repo, v]]);
  assert.deepEqual(current.onHandoff.calls, [['folder', v]]);
  assert.equal(menu.onRun, run); assert.equal(menu.onInstall, install); assert.equal(menu.onHandoff, handoff);
  assert.equal(initial.onRun.calls.length, 1);
});

test('group publication can immediately install with current actions; reopen does not duplicate installs', async () => {
  const [actions, setActions] = createSignal({ onRun() {}, onInstall() {}, onHandoff() {} });
  const menu = createRepositoryToolsActionForwarders(actions);
  const repo = { repositoryId: 'r', path: '/repo', npmInstallNeeded: true };
  const installs = [], installViews = [];
  let finishInstall;
  const a = setup({
    listRepositoryTools: vi.fn(() => Promise.resolve([{ ...repo }])),
    setActions,
    // Nonvisual view boundary: Solid may mount InstallControl synchronously
    // during the group setter. Call the real forwarded action at that point.
    setGroups: (groups) => {
      for (const group of groups) {
        const v = view(); installViews.push(v);
        installs.push(menu.onInstall(group, v));
      }
    },
    openRepositoryToolTerminal: vi.fn(() => new Promise((resolve) => { finishInstall = resolve; })),
  });
  await a.ctl.toggleRepositoryTools();
  assert.deepEqual(a.deps.openRepositoryToolTerminal.calls, [[repo, 'npm_install', '', 'workspace:w1:r:/repo']]);
  assert.equal(installViews[0].setStatus.calls[0][0], 'Starting npm install…');
  assert.deepEqual(installViews[0].setHidden.calls, [[true]]);
  await a.ctl.toggleRepositoryTools(); // Close leaves the existing install alone.
  assert.equal(a.deps.listRepositoryTools.calls.length, 1);
  await a.ctl.toggleRepositoryTools(); // Reopen while terminal startup is pending.
  assert.equal(a.deps.openRepositoryToolTerminal.calls.length, 1);
  assert.equal(installViews[1].setStatus.calls.at(-1)[0], 'npm install is already running.');
  finishInstall(true);
  await Promise.all(installs);
  assert.equal(installViews[0].setStatus.calls.at(-1)[0], 'npm install opened in an interactive terminal.');
  await a.ctl.toggleRepositoryTools();
  await a.ctl.toggleRepositoryTools(); // A started terminal still owns the install key.
  assert.equal(a.deps.openRepositoryToolTerminal.calls.length, 1);

  await a.ctl.toggleRepositoryTools();
  a.setOwner({ type: 'workspace', id: 'w2' });
  await a.ctl.toggleRepositoryTools();
  assert.equal(a.deps.openRepositoryToolTerminal.calls.length, 2);
  assert.equal(a.deps.openRepositoryToolTerminal.calls[1][3], 'workspace:w2:r:/repo');
  finishInstall(true);
  await Promise.all(installs);
  assert.deepEqual([...a.deps.installStarted], ['workspace:w1:r:/repo', 'workspace:w2:r:/repo']);
});

test('current controller actions run tools and handoffs with existing busy/status feedback', async () => {
  const [actions, setActions] = createSignal({ onRun() {}, onInstall() {}, onHandoff() {} });
  const menu = createRepositoryToolsActionForwarders(actions);
  const a = setup({ setActions }); await a.ctl.toggleRepositoryTools();
  const repo = { repositoryId: 'r', path: '/repo' };
  menu.onRun(repo, 'npm_script', 'test');
  menu.onRun(repo, 'make_target', 'check');
  assert.deepEqual(a.deps.openRepositoryToolTerminal.calls, [[repo, 'npm_script', 'test'], [repo, 'make_target', 'check']]);
  for (const action of ['shell', 'idea', 'folder']) {
    const v = view();
    await menu.onHandoff(action, v);
    assert.deepEqual(v.setDisabled.calls, [[true], [false]]);
    assert.deepEqual(v.setHidden.calls, [[false]]);
    assert.deepEqual(v.setStatus.calls, [[action === 'shell' ? 'Starting terminal…' : 'Opening…'], ['Opened successfully.']]);
  }
  assert.deepEqual(a.deps.openWorkbenchShellTerminal.calls, [[{ type: 'workspace', id: 'w1' }]]);
  assert.deepEqual(a.deps.launchWorkbenchOsHandoff.calls, [
    [a.deps.invoke, 'workspace', 'w1', 'idea'], [a.deps.invoke, 'workspace', 'w1', 'folder'],
  ]);
  a.deps.openWorkbenchShellTerminal.mockResolvedValue(false);
  const v = view(); await menu.onHandoff('shell', v);
  assert.equal(v.setStatus.calls.at(-1)[0], 'Could not open: Error: Terminal could not be started; see the workbench error.');
  assert.equal(v.setDisabled.calls.at(-1)[0], false);
  await a.ctl.toggleRepositoryTools();
  a.setOwner({ type: 'workspace', id: 'w2' });
  await a.ctl.toggleRepositoryTools();
  await menu.onHandoff('folder', view());
  assert.deepEqual(a.deps.launchWorkbenchOsHandoff.calls.at(-1), [a.deps.invoke, 'workspace', 'w2', 'folder']);
  menu.onRun(repo, 'npm_script', 'build');
  assert.deepEqual(a.deps.openRepositoryToolTerminal.calls.at(-1), [repo, 'npm_script', 'build']);
});

test('actions retained across owner changes cannot start tools, installs or handoffs', async () => {
  for (const nextOwner of [null, { type: 'workspace', id: 'w2' }, { type: 'task', id: 'w1' }]) {
    const a = setup(); await a.ctl.toggleRepositoryTools();
    const stale = a.state.actions;
    a.setOwner(nextOwner);
    const v = view(), repo = { repositoryId: 'r', path: '/repo' };
    stale.onRun(repo, 'npm_script', 'test');
    await stale.onInstall(repo, v);
    await stale.onHandoff('shell', v);
    await stale.onHandoff('folder', v);
    assert.equal(a.deps.openRepositoryToolTerminal.calls.length, 0);
    assert.equal(a.deps.openWorkbenchShellTerminal.calls.length, 0);
    assert.equal(a.deps.launchWorkbenchOsHandoff.calls.length, 0);
    assert.equal(a.deps.installStarted.size, 0);
    assert.equal(v.setStatus.calls.length, 0);
    assert.equal(v.setDisabled.calls.length, 0);
  }
});
