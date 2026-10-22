import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { loadChangeReview, renderChangeReview } from '../src/change-review-ui.js';

const sample = [
  { repositoryId: 'r1', name: 'Alpha', path: '/repos/alpha', comparisonTarget: 'origin/main', comparisonError: null, files: [
    { path: 'src/a.js', status: 'M', diff: '--- a/src/a.js\n+++ b/src/a.js\n-old\n+new\n', diffError: null },
  ] },
  { repositoryId: 'r2', name: 'Beta', path: '/repos/beta', comparisonTarget: null, comparisonError: 'Cannot resolve origin/main, origin/master, local main, or local master', files: [
    { path: 'new.txt', status: 'untracked', diff: '+hello\n', diffError: null },
  ] },
];

test('Change Review groups every repository, marks statuses, and switches selected diff presentation', () => {
  const window = new Window();
  globalThis.document = window.document;
  const page = window.document.createElement('section');
  page.innerHTML = '<h1 data-review-title></h1><div data-review-files></div><h2 data-review-file-title></h2><div data-review-diff></div><button data-review-mode="unified"></button><button data-review-mode="split"></button>';
  renderChangeReview(page, sample);
  assert.equal(page.querySelectorAll('.change-review-repository').length, 2);
  assert.match(page.querySelector('[data-review-title]').textContent, /2 repositories · 2 files changed/);
  assert.match(page.textContent, /Compare with: origin\/main/);
  assert.match(page.textContent, /Cannot resolve origin\/main, origin\/master, local main, or local master/);
  const fileButton = [...page.querySelectorAll('[data-review-files] button')].find((button) => button.textContent.includes('src/a.js'));
  fileButton.click();
  assert.match(page.querySelector('[data-review-diff]').textContent, /-old\n\+new/);
  page.querySelector('[data-review-mode="split"]').click();
  assert.equal(page.querySelectorAll('.change-review-split').length, 2);
  assert.equal(page.querySelector('[data-review-mode="split"]').getAttribute('aria-pressed'), 'true');
  window.close();
  delete globalThis.document;
});

test('Change Review adapter sends the selected owner and validates repository response', async () => {
  let sent;
  const result = await loadChangeReview(async (name, payload) => {
    sent = { name, payload };
    return sample;
  }, 'task', 'task-7');
  assert.deepEqual(sent, { name: 'change_review_load', payload: { request: { ownerType: 'task', ownerId: 'task-7' } } });
  assert.equal(result[1].files[0].status, 'untracked');
  await assert.rejects(() => loadChangeReview(async () => [{ ...sample[0], extra: true }], 'workspace', 'w1'), /unknown field/);
});

test('repository with a local main fallback reports no changed files for a clean matching checkout', () => {
  const window = new Window();
  globalThis.document = window.document;
  const page = window.document.createElement('section');
  page.innerHTML = '<h1 data-review-title></h1><div data-review-files></div><h2 data-review-file-title></h2><div data-review-diff></div><button data-review-mode="unified"></button><button data-review-mode="split"></button>';
  renderChangeReview(page, [{ repositoryId: 'repo', name: 'Repo A', path: '/repo-a', comparisonTarget: 'local main', comparisonError: null, files: [] }]);
  assert.match(page.querySelector('[data-review-files]').textContent, /No changed files against the selected comparison branch/);
  assert.match(page.textContent, /Compare with: local main/);
  assert.doesNotMatch(page.textContent, /File list unavailable/);
  window.close();
  delete globalThis.document;
});

test('repository with no supported base keeps a clear empty working-tree state', () => {
  const window = new Window();
  globalThis.document = window.document;
  const page = window.document.createElement('section');
  page.innerHTML = '<h1 data-review-title></h1><div data-review-files></div><h2 data-review-file-title></h2><div data-review-diff></div><button data-review-mode="unified"></button><button data-review-mode="split"></button>';
  renderChangeReview(page, [{ repositoryId: 'repo', name: 'No base', path: '/repo', comparisonTarget: null, comparisonError: 'Cannot resolve origin/main, origin/master, local main, or local master', files: [] }]);
  assert.match(page.querySelector('[data-review-files]').textContent, /No working-tree changes to list/);
  assert.match(page.textContent, /Comparison diff is unavailable/);
  window.close();
  delete globalThis.document;
});
