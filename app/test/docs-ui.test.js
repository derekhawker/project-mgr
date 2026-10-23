import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import { JSDOM } from 'jsdom';
import { createDocsController } from '../src/docs-controller.js';
import { loadDocs, readDoc, renderDocContent, renderDocs, renderDocsMessage, selectDocPath } from '../src/docs-ui.js';

test('Docs adapters validate the owner-scoped list and selected-file command contracts', async () => {
  let command;
  const files = [{ path: 'README.md', repositoryId: 'r-api', repositoryName: 'api' }];
  assert.deepEqual(await loadDocs(async (name, payload) => {
    command = { name, payload };
    return files;
  }, 'task', 'task-42'), files);
  assert.deepEqual(command, {
    name: 'docs_list',
    payload: { request: { ownerType: 'task', ownerId: 'task-42' } },
  });
  await assert.rejects(() => loadDocs(async () => [{ path: 'README.md', extra: true }], 'workspace', 'w1'), /unknown field/);
  let readCommand;
  const document = await readDoc(async (name, payload) => {
    readCommand = { name, payload };
    return { path: 'README.md', contents: '# API' };
  }, 'task', 'task-42', { path: 'README.md', repositoryId: 'r-api' });
  assert.deepEqual(readCommand, {
    name: 'docs_read',
    payload: { request: { ownerType: 'task', ownerId: 'task-42', path: 'README.md', repositoryId: 'r-api' } },
  });
  assert.equal(document.contents, '# API');
});

test('Markdown files render as sanitized Markdown and text files render as plain text', () => {
  const window = new JSDOM('<!doctype html><body></body>').window;
  globalThis.document = window.document;
  const page = window.document.createElement('section');
  page.innerHTML = '<aside data-doc-files></aside><section data-doc-content><h2></h2><pre></pre></section>';
  renderDocs(page, [
    { path: 'README.md', repositoryId: 'r-api', repositoryName: 'api' },
    { path: 'README.md', repositoryId: 'r-web', repositoryName: 'web' },
  ], () => {});
  const [first, second] = page.querySelectorAll('[data-doc-files] button');
  assert.equal(first.textContent, 'README.md');
  assert.deepEqual([...page.querySelectorAll('.docs-source h2')].map((heading) => heading.textContent), ['api', 'web']);
  selectDocPath(page, { path: 'README.md', repositoryId: 'r-api' });
  renderDocContent(page, { path: 'README.md', contents: '# API\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))' });
  assert.equal(page.querySelector('.docs-markdown h1').textContent, 'API');
  assert.equal(page.querySelector('.docs-markdown script'), null);
  assert.equal(page.querySelector('.docs-markdown a').getAttribute('href'), null);
  selectDocPath(page, { path: 'README.md', repositoryId: 'r-web' });
  renderDocContent(page, { path: 'notes.TXT', contents: '<b>plain text</b>' });
  assert.equal(second.getAttribute('aria-current'), 'true');
  assert.equal(page.querySelectorAll('[data-doc-files] button').length, 2);
  assert.equal(page.querySelector('[data-doc-content] h2').textContent, 'notes.TXT');
  assert.equal(page.querySelector('[data-doc-content] pre').textContent, '<b>plain text</b>');
  assert.equal(page.querySelector('[data-doc-content] b'), null);
  window.close();
  delete globalThis.document;
});

test('Docs reader centers a short message when data is unavailable', () => {
  const window = new Window();
  globalThis.document = window.document;
  const page = window.document.createElement('section');
  page.innerHTML = '<aside data-doc-files></aside><section data-doc-content><h2></h2><pre></pre></section>';
  renderDocsMessage(page, 'Could not load documents.');
  assert.equal(page.querySelector('[data-doc-files]').children.length, 0);
  assert.equal(page.querySelector('[data-doc-content]').textContent, 'Could not load documents.');
  assert.equal(page.querySelector('.docs-message').getAttribute('role'), 'status');
  assert.equal(page.classList.contains('message-only'), true);
  window.close();
  delete globalThis.document;
});

test('Custom Tools Docs destination opens and renders in the visible work area', async () => {
  const window = new JSDOM('<!doctype html><body></body>').window;
  globalThis.document = window.document;
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  window.document.body.innerHTML = html;
  const docs = window.document.querySelector('#docs-page');
  const button = window.document.querySelector('#show-docs');
  const changeReview = window.document.querySelector('#change-review-page');
  const changeReviewButton = window.document.querySelector('#show-change-review');
  const selectedOwner = window.document.querySelector('#selected-owner');
  const terminal = window.document.createElement('div');
  terminal.id = 'retained-terminal-session';
  window.document.querySelector('#terminal-views').append(terminal);
  let owner = { type: 'workspace', id: 'custom-tools' };
  const controller = createDocsController({
    button,
    page: docs,
    invoke: async (name, payload) => {
      const request = { ownerType: 'workspace', ownerId: 'custom-tools' };
      if (name === 'docs_read') Object.assign(request, { path: payload.request.path, repositoryId: payload.request.repositoryId });
      assert.deepEqual(payload, { request });
      if (name === 'docs_list') return [
        { path: 'codesitter/golang/README.md', repositoryId: 'custom-tools-id', repositoryName: 'custom-tools' },
        { path: 'notes.txt', repositoryId: 'custom-tools-id', repositoryName: 'custom-tools' },
      ];
      assert.equal(name, 'docs_read');
      return { path: payload.request.path, contents: payload.request.path.endsWith('.md') ? '# Custom Tools' : 'Notes' };
    },
    getOwner: () => owner,
    onOpen: () => {
      changeReview.hidden = true;
      changeReviewButton.classList.remove('selected');
      selectedOwner.hidden = true;
    },
  });
  assert.equal(docs.parentElement.id, 'right-content');
  assert.equal(docs.closest('#no-selection'), null);
  assert.equal(button.textContent, 'Docs');
  assert.equal(button.hasAttribute('hidden'), false);
  assert.equal(button.disabled, true);
  await controller.refresh();
  assert.equal(button.disabled, false);
  changeReview.hidden = false;
  changeReviewButton.classList.add('selected');
  await controller.open();
  assert.equal(docs.hidden, false);
  assert.equal(changeReview.hidden, true);
  assert.equal(changeReviewButton.classList.contains('selected'), false);
  assert.equal(selectedOwner.hidden, true);
  assert.equal(docs.querySelector('[data-doc-files] button').textContent, 'codesitter/golang/README.md');
  assert.equal(docs.querySelector('[data-doc-files] button').getAttribute('aria-current'), 'true');
  assert.equal(docs.querySelector('[data-doc-content] .docs-markdown h1').textContent, 'Custom Tools');
  await controller.select('notes.txt', 'custom-tools-id');
  assert.equal(docs.querySelector('[data-doc-files] button[aria-current="true"]').textContent, 'notes.txt');
  assert.equal(docs.querySelector('[data-doc-content] pre').textContent, 'Notes');
  assert.equal(terminal.isConnected, true);
  controller.showTerminal();
  assert.equal(docs.hidden, true);
  assert.equal(terminal.isConnected, true);
  owner = null;
  window.close();
  delete globalThis.document;
});

test('Docs tab disables after a confirmed empty result and shows a centered fallback on list failure', async () => {
  const window = new Window();
  globalThis.document = window.document;
  const page = window.document.createElement('section');
  page.innerHTML = '<aside data-doc-files></aside><section data-doc-content></section>';
  const button = window.document.createElement('button');
  let result = [];
  const controller = createDocsController({
    button,
    page,
    invoke: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
    getOwner: () => ({ type: 'workspace', id: 'w' }),
    onOpen() {},
  });
  await controller.refresh();
  assert.equal(button.disabled, true);
  result = new Error('temporary read failure');
  await controller.refresh();
  assert.equal(button.disabled, false);
  await controller.open();
  assert.equal(page.classList.contains('message-only'), true);
  assert.match(page.textContent, /temporary read failure/);
  assert.equal(button.disabled, false);
  window.close();
  delete globalThis.document;
});
