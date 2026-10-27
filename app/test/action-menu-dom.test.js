import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp('/tmp/opencode/action-menu-');
const entry = join(temp, 'entry.js');
await writeFile(entry, `
export { render } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/web/dist/web.js'))};
export { createComponent } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/dist/solid.js'))};
export { ActionMenu } from ${JSON.stringify(resolve(root, 'src/ui/action-menu.jsx'))};
`);
try { await build({ configFile: false, root, plugins: [solid()], logLevel: 'silent', build: { outDir: join(temp, 'out'), lib: { entry, formats: ['es'], fileName: 'test' }, rollupOptions: { output: { inlineDynamicImports: true } } } }); }
catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
const window = new Window();
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent']) globalThis[key] = key === 'window' ? window : key === 'document' ? window.document : window[key];
const { render, createComponent, ActionMenu } = await import(pathToFileURL(join(temp, 'out/test.js')));
function mount(children) {
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => createComponent(ActionMenu, { label: 'Actions', children }), host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}
const open = (view) => { const details = view.host.querySelector('details'); details.open = true; return details; };
test.after(async () => { await window.happyDOM.abort(); await rm(temp, { recursive: true, force: true }); });

test('outside pointer closes only its disclosure; Escape closes and restores summary focus', () => {
  const button = (text) => { const node = document.createElement('button'); node.textContent = text; return node; };
  const one = mount(button('Run'));
  const two = mount(button('Other'));
  const first = open(one), second = open(two);
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(first.open, false); assert.equal(second.open, false);
  open(one); const summary = one.host.querySelector('summary');
  one.host.querySelector('button').focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(first.open, false); assert.equal(document.activeElement, summary);
  one.dispose(); two.dispose();
});

test('enabled buttons and links close, disabled actions do not', () => {
  const children = document.createElement('div');
  children.innerHTML = '<button disabled>Disabled</button><button aria-disabled="true">Unavailable</button><a aria-disabled="true" href="#">Unavailable link</a><button>Run</button><a href="#next">Next</a>';
  const view = mount(children);
  const details = open(view);
  for (const action of view.host.querySelectorAll('button[disabled], [aria-disabled="true"]')) {
    action.click(); assert.equal(details.open, true);
  }
  view.host.querySelector('button:not([disabled]):not([aria-disabled])').click();
  assert.equal(details.open, false);
  open(view); view.host.querySelector('a:not([aria-disabled])').click();
  assert.equal(details.open, false);
  view.dispose();
});
