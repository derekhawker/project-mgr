import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp('/tmp/opencode/workbench-ui-');
const entry = join(temp, 'entry.js');
await writeFile(entry, `
export { render } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/web/dist/web.js'))};
export { createComponent, createSignal } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/dist/solid.js'))};
export { SessionTabList } from ${JSON.stringify(resolve(root, 'src/session-tab-list.jsx'))};
export { RepositoryToolsMenu } from ${JSON.stringify(resolve(root, 'src/repository-tools-menu.jsx'))};
export { WorkspaceOwnerPanel } from ${JSON.stringify(resolve(root, 'src/workspace-owner-panel.jsx'))};
`);
try { await build({ configFile: false, root, plugins: [solid()], logLevel: 'silent', build: { outDir: join(temp, 'out'), lib: { entry, formats: ['es'], fileName: 'test' }, rollupOptions: { output: { inlineDynamicImports: true } } } }); }
catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
const window = new Window();
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent']) globalThis[key] = key === 'window' ? window : key === 'document' ? window.document : window[key];
const { render, createComponent, createSignal, SessionTabList, RepositoryToolsMenu, WorkspaceOwnerPanel } = await import(pathToFileURL(join(temp, 'out/test.js')));
function mount(Component, props) {
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => createComponent(Component, props), host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}
test.after(async () => { await window.happyDOM.abort(); await rm(temp, { recursive: true, force: true }); });

test('session tabs retain terminal associations and action callbacks', () => {
  const calls = [];
  const view = mount(SessionTabList, { tabs: () => [{ sessionId: 's1', ownerKey: 'w1', label: 'Session', visible: true, selected: true, restartable: true, closeable: true, onSelect: () => calls.push('select'), onRestart: () => calls.push('restart'), onClose: () => calls.push('close') }] });
  const tab = view.host.querySelector('[role=tab]');
  assert.equal(tab.getAttribute('aria-controls'), 'terminal-s1'); assert.equal(tab.dataset.ownerKey, 'w1');
  assert.equal(tab.getAttribute('aria-selected'), 'true'); assert.equal(tab.tabIndex, 0); assert.equal(tab.classList.contains('selected'), true);
  tab.click(); view.host.querySelector('[data-restart-session]').click(); view.host.querySelector('[aria-label="Close Session"]').click();
  assert.deepEqual(calls, ['select', 'restart', 'close']); view.dispose();
});

test('repository menu remains controlled and forwards selected tool', () => {
  const [open, setOpen] = createSignal(false); const calls = [];
  const view = mount(RepositoryToolsMenu, { open, available: () => true, disabled: () => false, error: () => '', groups: () => [{ name: 'Repo', packageScripts: ['test'], makeTargets: [] }], onToggle: () => setOpen(!open()), onRun: (...args) => calls.push(args), onHandoff: () => {} });
  const toggle = view.host.querySelector('#show-repo-tools'); const menu = view.host.querySelector('#repo-tools-menu');
  const disclosure = toggle.closest('details');
  assert.equal(disclosure.open, false); toggle.click(); assert.equal(toggle.getAttribute('aria-expanded'), 'true'); assert.equal(disclosure.open, true);
  [...menu.querySelectorAll('button')].find(button => button.textContent === 'test').click();
  assert.equal(calls[0][1], 'npm_script'); assert.equal(calls[0][2], 'test'); view.dispose();
});

test('owner visibility and form updates do not replace terminal host', () => {
  const [visible, setVisible] = createSignal(true); let prompt = '';
  const falseValue = () => false, empty = () => '', list = () => [];
  const props = { visible, proposalMode: falseValue, title: empty, description: empty, status: empty, pendingPromptVisible: falseValue, pendingPromptText: empty, pendingPromptDisabled: falseValue, pendingPromptLabel: empty, sessionStatus: empty, quickRequestTerminalActions: falseValue, selectedAttachRepository: empty, attachRepositoryOptions: list, quickRequest: falseValue, attachRepositoryDisabled: falseValue, completeWorkspaceDisabled: falseValue, reactivateWorkspaceDisabled: falseValue, repositories: list, workspacePrompt: empty, workspaceSessionSubmitDisabled: falseValue, terminalRuntimeStartupFailed: falseValue, quickRequestBusy: falseValue, quickPrompt: empty, modelBusy: falseValue, modelDisabled: falseValue, selectedModel: empty, modelOptions: list, modelError: empty, quickRequestError: empty, onWorkspacePromptInput: value => { prompt = value; } };
  const view = mount(WorkspaceOwnerPanel, props); const terminal = view.host.querySelector('#terminal-views');
  const child = document.createElement('div'); terminal.append(child);
  const field = view.host.querySelector('#workspace-prompt'); field.value = 'Plan'; field.dispatchEvent(new Event('input', { bubbles: true }));
  setVisible(false); setVisible(true);
  assert.equal(prompt, 'Plan'); assert.equal(view.host.querySelector('#terminal-views'), terminal); assert.equal(terminal.firstChild, child);
  assert.equal(view.host.querySelector('#workspace-session-submit').type, 'submit'); view.dispose();
});
