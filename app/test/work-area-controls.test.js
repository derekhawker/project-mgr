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
const temp = await mkdtemp(join(tmpdir(), 'work-area-test-'));
const entry = join(temp, 'entry.js');
await writeFile(entry, `
  export { render } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/web/dist/web.js'))};
  export { createComponent, createSignal } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/dist/solid.js'))};
  export { QuickRequestHistoryPage } from ${JSON.stringify(resolve(root, 'src/quick-request-history-page.jsx'))};
  export { ChangeReviewPanel } from ${JSON.stringify(resolve(root, 'src/change-review-panel.jsx'))};
`);
try {
  await build({ configFile: false, root, plugins: [solid()], build: { outDir: join(temp, 'out'), lib: { entry, formats: ['es'], fileName: 'test' }, rollupOptions: { output: { inlineDynamicImports: true } } } });
} catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
const window = new Window();
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event']) globalThis[key] = key === 'window' ? window : key === 'document' ? window.document : window[key];
const { render, createComponent, createSignal, QuickRequestHistoryPage, ChangeReviewPanel } = await import(pathToFileURL(join(temp, 'out/test.js')));
test.after(async () => { await window.happyDOM.abort(); await rm(temp, { recursive: true, force: true }); });
function mount(component, props) {
  const host = document.createElement('div'); document.body.append(host);
  const dispose = render(() => createComponent(component, props), host);
  return { host, dispose() { dispose(); host.remove(); } };
}

test('Quick Request search and actions retain their callbacks and labels', () => {
  const record = { task: { id: 'one' }, prompt: 'Original prompt' };
  const calls = [];
  const view = mount(QuickRequestHistoryPage, { visible: () => true, records: () => [record], selectedId: () => null,
    onNew: () => calls.push('new'), onSearch: value => calls.push(value), onOpen: value => calls.push(value), onDelete: value => calls.push(value) });
  const input = view.host.querySelector('input'); input.value = 'find'; input.dispatchEvent(new Event('input', { bubbles: true }));
  view.host.querySelector('#new-quick-request').click();
  view.host.querySelector('[aria-label="Open Quick Request: Original prompt"]').click();
  [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Delete').click();
  assert.deepEqual(calls, ['find', 'new', record, record]);
  view.dispose();
});

test('Change Review controls preserve mode and terminal navigation', () => {
  const [mode, setMode] = createSignal('unified'); let back = 0;
  const view = mount(ChangeReviewPanel, { visible: () => true, repositories: () => [], summary: () => '', error: () => '', mode, onMode: setMode, onBack: () => back++ });
  const split = view.host.querySelector('[data-review-mode="split"]'); split.click();
  assert.equal(mode(), 'split'); assert.equal(split.getAttribute('aria-pressed'), 'true');
  view.host.querySelector('#change-review-back').click(); assert.equal(back, 1);
  view.dispose();
});
