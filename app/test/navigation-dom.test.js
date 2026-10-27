import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'project-mgr-navigation-'));
const entry = join(temp, 'entry.js');
await writeFile(entry, `
  export { render } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/web/dist/web.js'))};
  export { createComponent, createSignal } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/dist/solid.js'))};
  export { NewWorkMenu } from ${JSON.stringify(resolve(root, 'src/new-work-menu.jsx'))};
  export { WorkspaceNavigation } from ${JSON.stringify(resolve(root, 'src/workspace-navigation.jsx'))};
`);
try {
  await build({ configFile: false, root, plugins: [solid()], build: {
    outDir: join(temp, 'dist'), lib: { entry, formats: ['es'], fileName: 'navigation' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  } });
} catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
const window = new Window();
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent']) {
  globalThis[key] = key === 'window' ? window : key === 'document' ? window.document : window[key];
}
const { render, createComponent, createSignal, NewWorkMenu, WorkspaceNavigation } = await import(pathToFileURL(join(temp, 'dist/navigation.js')));
function mount(Component, props) {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => createComponent(Component, props), host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}
test.after(async () => { await window.happyDOM.abort(); await rm(temp, { recursive: true, force: true }); });

test('New work closes the native disclosure before reporting either choice', () => {
  const choices = [];
  const view = mount(NewWorkMenu, { onChoose: type => choices.push([type, view.host.querySelector('details').open]) });
  const menu = view.host.querySelector('details');
  assert.equal(menu.querySelector('summary').textContent, 'New work');
  assert.equal(menu.querySelector('[role=group]').getAttribute('aria-label'), 'Choose work type');
  for (const type of ['workspace', 'quick_request']) {
    menu.open = true;
    menu.querySelector(`[data-new-work-type="${type}"]`).click();
  }
  assert.deepEqual(choices, [['workspace', false], ['quick_request', false]]);
  view.dispose();
});

test('workspace navigation filters, selects, and tracks verified repositories', () => {
  const active = { id: 'a', name: 'Active', kind: 'regular', status: 'active' };
  const [selected, setSelected] = createSignal(null);
  const view = mount(WorkspaceNavigation, {
    data: () => ({ workspaces: [active, { id: 'b', name: 'Done', kind: 'regular', status: 'completed' }],
      workspaceRepositories: [{ workspaceId: 'a', verificationStatus: 'verified' }] }),
    busy: () => false, selected, onSelect: setSelected,
  });
  const buttons = view.host.querySelectorAll('button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].querySelector('[title]').title, '1 associated Git repository');
  buttons[0].click();
  assert.equal(selected(), active);
  assert.equal(buttons[0].getAttribute('aria-current'), 'page');
  view.dispose();
});
