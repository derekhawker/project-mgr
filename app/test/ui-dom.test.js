import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'project-mgr-ui-dom-'));
const entry = join(temp, 'entry.js');
const output = join(temp, 'bundle');
await writeFile(entry, `
  export { render } from ${JSON.stringify(resolve(appRoot, 'node_modules/solid-js/web/dist/web.js'))};
  export { createSignal, createComponent } from ${JSON.stringify(resolve(appRoot, 'node_modules/solid-js/dist/solid.js'))};
  export { Button } from ${JSON.stringify(resolve(appRoot, 'src/ui/Button.jsx'))};
  export { Input } from ${JSON.stringify(resolve(appRoot, 'src/ui/Input.jsx'))};
  export { ActionMenu } from ${JSON.stringify(resolve(appRoot, 'src/ui/action-menu.jsx'))};
  export { Modal } from ${JSON.stringify(resolve(appRoot, 'src/ui/modal.jsx'))};
  export { Drawer } from ${JSON.stringify(resolve(appRoot, 'src/ui/drawer.jsx'))};
  export { Tabs } from ${JSON.stringify(resolve(appRoot, 'src/ui/tabs.jsx'))};
  export { Notice } from ${JSON.stringify(resolve(appRoot, 'src/ui/Notice.jsx'))};
  export { DirectoriesLibraryForm } from ${JSON.stringify(resolve(appRoot, 'src/directories-library-form.jsx'))};
  export { RepositoryDirectories } from ${JSON.stringify(resolve(appRoot, 'src/repository-directories.jsx'))};
  export { NewWorkDialog } from ${JSON.stringify(resolve(appRoot, 'src/new-work-dialog.jsx'))};
`);
try {
  await build({
    configFile: false,
    root: appRoot,
    plugins: [solid()],
    build: { outDir: output, emptyOutDir: true, cssCodeSplit: false, lib: { entry, formats: ['es'], fileName: 'ui-dom' }, rollupOptions: { output: { inlineDynamicImports: true } } },
  });
} catch (error) {
  await rm(temp, { recursive: true, force: true });
  throw error;
}

const window = new Window();
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLDialogElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent']) {
  globalThis[key] = key === 'window' ? window : key === 'document' ? window.document : window[key];
}
// happy-dom supplies real dialog elements but not the native modal methods.
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };

const { render, createSignal, createComponent, Button, Input, ActionMenu, Modal, Drawer, Tabs, Notice, DirectoriesLibraryForm, RepositoryDirectories, NewWorkDialog } = await import(pathToFileURL(join(output, 'ui-dom.js')));
const component = (Component, props) => createComponent(Component, props);
function mount(componentFactory) {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(componentFactory, host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}

test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test('Button and Input preserve native attributes, events, and input values', () => {
  let clicked = 0;
  const button = mount(() => component(Button, { type: 'submit', onClick: () => clicked++, children: 'Save' }));
  const nativeButton = button.host.querySelector('button');
  assert.equal(nativeButton.type, 'submit');
  nativeButton.click();
  assert.equal(clicked, 1);
  button.dispose();

  const input = mount(() => component(Input, { 'aria-label': 'Name', value: 'Ada', onInput: (event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase(); } }));
  const field = input.host.querySelector('input');
  assert.equal(field.getAttribute('aria-label'), 'Name');
  assert.equal(field.value, 'Ada');
  field.value = 'grace';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(field.value, 'GRACE');
  input.dispose();
});

test('adopted directory controls keep form and repository events intact', () => {
  let path = '', saves = 0, toggled;
  const form = mount(() => component(DirectoriesLibraryForm, {
    addingDirectories: () => false, saving: () => false, path: () => '/old', status: () => '',
    onPathInput: value => { path = value; }, onSave: event => { event.preventDefault(); saves++; },
    onAddDirectories: () => {}, onChoose: () => {},
  }));
  const input = form.host.querySelector('#repository-library-path');
  input.value = '/new';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(path, '/new');
  assert.equal(saves, 1);
  assert.equal(form.host.querySelector('[type=submit]').type, 'submit');
  form.dispose();

  const repository = { id: 'repo', name: 'Repo', repositoryPath: '/repo' };
  const list = mount(() => component(RepositoryDirectories, {
    groups: () => [{ path: '/', repositories: [{ repository, enabled: true }] }],
    pendingRepositoryId: () => null, onToggle: (repo, enabled) => { toggled = [repo, enabled]; },
  }));
  const checkbox = list.host.querySelector('input');
  assert.equal(checkbox.checked, true);
  checkbox.click();
  assert.deepEqual(toggled, [repository, false]);
  list.dispose();
});

test('New work uses native dialog and adopted controls without taking over cancellation', () => {
  let prompt = '', cancelled = 0, submitted = 0;
  const proposal = { workType: 'workspace', title: 'Review', originalPrompt: 'original', createLabel: 'Create' };
  const props = {
    proposal: () => proposal, captureVisible: () => true, reviewVisible: () => false, workType: () => 'workspace',
    prompt: () => '', setPrompt: value => { prompt = value; }, onCancel: () => cancelled++,
    onCapture: event => { event.preventDefault(); submitted++; }, onDialogCancel: () => cancelled++, onDialogClick: () => {}, onEnterToSubmit: () => {},
    progressVisible: () => false, progressRows: () => [], captureError: () => '', captureDisabled: () => false,
    workspaceName: () => '', setWorkspaceName: () => {}, startingPrompt: () => '', setStartingPrompt: () => {},
    directoryId: () => '', onDirectoryChange: () => {}, directories: () => [], directoryPath: () => '',
    proposalModelDisabled: () => false, proposalSelectedModel: () => '', setProposalSelectedModel: () => {}, proposalModels: () => [],
    onBack: () => {}, onConfirm: () => {}, proposalCreateDisabled: () => false, proposalError: () => '',
  };
  const mounted = mount(() => component(NewWorkDialog, props));
  assert.ok(mounted.host.querySelector('dialog'));
  mounted.host.querySelector('dialog').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(cancelled, 0);
  const field = mounted.host.querySelector('#new-work-prompt');
  field.value = '  unchanged  ';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  mounted.host.querySelector('#new-work-capture').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  mounted.host.querySelector('#new-work-cancel').click();
  assert.equal(prompt, '  unchanged  ');
  assert.equal(submitted, 1);
  assert.equal(cancelled, 1);
  mounted.dispose();
});

test('ActionMenu toggles native disclosure state and reports it', async () => {
  const states = [];
  const mounted = mount(() => component(ActionMenu, { label: 'Actions', onToggle: (open) => states.push(open), children: 'Run' }));
  const details = mounted.host.querySelector('details');
  assert.equal(details.open, false);
  assert.equal(mounted.host.querySelector('[role="group"]').getAttribute('aria-label'), 'Actions');
  details.open = true;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(states, [true]);
  mounted.dispose();
});

for (const [name, Component] of [['Modal', Modal], ['Drawer', Drawer]]) {
  test(`${name} follows controlled open state and requests close without owning it`, () => {
    const [open, setOpen] = createSignal(false);
    let requests = 0;
    const mounted = mount(() => component(Component, { get open() { return open(); }, title: 'Details', titleId: 'details-title', onCloseRequest: () => requests++, children: 'Body' }));
    const dialog = mounted.host.querySelector('dialog');
    assert.equal(dialog.open, false);
    setOpen(true);
    assert.equal(dialog.open, true);
    assert.equal(dialog.getAttribute('aria-labelledby'), 'details-title');
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(requests, 1);
    assert.equal(dialog.open, true);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(requests, 1);
    setOpen(false);
    assert.equal(dialog.open, false);
    mounted.dispose();
  });
}

test('Tabs update selection on click and keyboard, skipping disabled tabs', () => {
  const [value, setValue] = createSignal('one');
  const tabs = [{ id: 'one', label: 'One', panel: 'First' }, { id: 'disabled', label: 'Disabled', disabled: true, panel: 'No' }, { id: 'two', label: 'Two', panel: 'Second' }];
  const mounted = mount(() => component(Tabs, { label: 'Views', tabs, get value() { return value(); }, onChange: setValue }));
  const [one, disabled, two] = mounted.host.querySelectorAll('[role="tab"]');
  assert.equal(one.getAttribute('aria-selected'), 'true');
  assert.equal(mounted.host.querySelector('[role="tabpanel"]').textContent, 'First');
  one.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(value(), 'two');
  assert.equal(two.getAttribute('aria-selected'), 'true');
  assert.equal(disabled.disabled, true);
  assert.equal(mounted.host.querySelectorAll('[role="tabpanel"]')[0].hidden, true);
  two.click();
  assert.equal(value(), 'two');
  mounted.dispose();
});

test('Notice renders only nonempty content and reacts to message changes', () => {
  const [message, setMessage] = createSignal('Saved');
  const mounted = mount(() => component(Notice, { get message() { return message(); } }));
  assert.equal(mounted.host.querySelector('[role="status"]').textContent, 'Saved');
  setMessage('Updated');
  assert.equal(mounted.host.querySelector('[role="status"]').textContent, 'Updated');
  setMessage('');
  assert.equal(mounted.host.querySelector('[role="status"]'), null);
  mounted.dispose();
});
