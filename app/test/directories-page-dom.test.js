import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'directories-dom-'));
const entry = join(temp, 'entry.js');
await writeFile(entry, `
  export { render } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/web/dist/web.js'))};
  export { createComponent } from ${JSON.stringify(resolve(root, 'node_modules/solid-js/dist/solid.js'))};
  export { DirectoriesPage } from ${JSON.stringify(resolve(root, 'src/directories-page.jsx'))};
  export { LegacyArchivesList } from ${JSON.stringify(resolve(root, 'src/legacy-archives-list.jsx'))};
`);
try {
  await build({ configFile: false, root, plugins: [solid()], build: { outDir: join(temp, 'out'), lib: { entry, formats: ['es'], fileName: 'test' }, rollupOptions: { output: { inlineDynamicImports: true } } } });
} catch (error) { await rm(temp, { recursive: true, force: true }); throw error; }
const window = new Window();
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event']) globalThis[key] = key === 'window' ? window : key === 'document' ? window.document : window[key];
const { render, createComponent, DirectoriesPage, LegacyArchivesList } = await import(pathToFileURL(join(temp, 'out/test.js')));
test.after(async () => { await window.happyDOM.abort(); await rm(temp, { recursive: true, force: true }); });

test('page retains accessible landmarks and back action', () => {
  const host = document.createElement('div'); document.body.append(host); let backs = 0;
  const dispose = render(() => createComponent(DirectoriesPage, { visible: () => true, status: () => 'Scanning', onBack: () => backs++ }), host);
  assert.equal(host.querySelector('#directories-page').getAttribute('aria-labelledby'), 'directories-title');
  assert.equal(host.querySelector('#repository-status').getAttribute('role'), 'status');
  assert.equal(host.querySelector('#directory-list').getAttribute('aria-label'), 'Repositories grouped by directory');
  host.querySelector('#directories-back').click(); assert.equal(backs, 1);
  dispose(); host.remove();
});
test('archive restore keeps disabled states and passes the record', () => {
  const host = document.createElement('ul'); document.body.append(host); let restored;
  const records = [{ taskId: 'one', workspaceId: 'w', archivedAt: 0 }, { taskId: 'two', workspaceId: 'w', archivedAt: 0, restoredAt: 1 }, { taskId: 'three', workspaceId: 'w', archivedAt: 0 }];
  const dispose = render(() => createComponent(LegacyArchivesList, { error: () => '', records: () => records, isRestoring: id => id === 'three', onRestore: record => { restored = record; } }), host);
  const buttons = host.querySelectorAll('button');
  buttons[0].click(); assert.equal(restored, records[0]);
  assert.equal(buttons[1].disabled, true); assert.equal(buttons[1].textContent, 'Restored');
  assert.equal(buttons[2].disabled, true);
  dispose(); host.remove();
});
