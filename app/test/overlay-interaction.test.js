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
const temp = await mkdtemp(join(tmpdir(), 'overlay-interaction-'));
const entry = join(temp, 'entry.js');
const output = join(temp, 'bundle');
await writeFile(entry, `
  export { render } from ${JSON.stringify(resolve(appRoot, 'node_modules/solid-js/web/dist/web.js'))};
  export { createSignal, createComponent } from ${JSON.stringify(resolve(appRoot, 'node_modules/solid-js/dist/solid.js'))};
  export { Modal } from ${JSON.stringify(resolve(appRoot, 'src/ui/modal.jsx'))};
  export { Drawer } from ${JSON.stringify(resolve(appRoot, 'src/ui/drawer.jsx'))};
  export { Tabs } from ${JSON.stringify(resolve(appRoot, 'src/ui/tabs.jsx'))};
`);
try {
  await build({ configFile: false, root: appRoot, define: { 'import.meta.env.DEV': 'true' }, plugins: [solid()], build: { outDir: output, emptyOutDir: true, cssCodeSplit: false, lib: { entry, formats: ['es'], fileName: 'overlay-test' }, rollupOptions: { output: { inlineDynamicImports: true } } } });
} catch (error) {
  await rm(temp, { recursive: true, force: true });
  throw error;
}

const window = new Window();
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLDialogElement', 'Event', 'MouseEvent']) globalThis[key] = key === 'window' ? window : key === 'document' ? window.document : window[key];
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { render, createSignal, createComponent, Modal, Drawer, Tabs } = await import(pathToFileURL(join(output, 'overlay-test.js')));
const mount = (Component, props) => {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => createComponent(Component, props), host);
  return { host, dispose: () => { dispose(); host.remove(); } };
};

test.after(async () => { await window.happyDOM.abort(); await rm(temp, { recursive: true, force: true }); });

for (const [name, Component, expectedCloseName] of [['Modal', Modal, 'Close dialog'], ['Drawer', Drawer, 'Close drawer']]) {
  test(`${name}: backdrop is inert, Escape and visible close request controlled closure`, () => {
    const [open, setOpen] = createSignal(true);
    let requests = 0;
    const mounted = mount(Component, { get open() { return open(); }, title: 'Details', onCloseRequest: () => requests++ , children: 'Content' });
    const dialog = mounted.host.querySelector('dialog');
    assert.equal(dialog.open, true);
    assert.equal(dialog.getAttribute('aria-labelledby')?.length > 0, true);

    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(requests, 0, 'backdrop click does not dismiss');

    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(requests, 1);
    assert.equal(dialog.open, true, 'controlled owner can veto closure');

    const close = mounted.host.querySelector('button');
    assert.equal(close.getAttribute('aria-label'), expectedCloseName);
    close.click();
    assert.equal(requests, 2);
    assert.equal(dialog.open, true);
    setOpen(false);
    assert.equal(dialog.open, false);
    mounted.dispose();
  });
}

test('unnamed dialogs and tab lists warn in development; labelled components do not', () => {
  const warnings = [];
  const previous = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    for (const Component of [Modal, Drawer, Tabs]) {
      const missing = mount(Component, { open: false, tabs: [] });
      missing.dispose();
      const named = mount(Component, Component === Tabs ? { tabs: [], labelledBy: 'heading' } : { open: false, 'aria-labelledby': 'heading' });
      named.dispose();
    }
    assert.deepEqual(warnings, [
      'Modal requires a title, aria-label, or aria-labelledby.',
      'Drawer requires a title, aria-label, or aria-labelledby.',
      'Tabs requires a label or labelledBy.',
    ]);
  } finally { console.warn = previous; }
});
