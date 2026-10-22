import assert from 'node:assert/strict';
import test from 'node:test';
import { clearNoticeIfStartsWith, showCleanupError } from '../src/error-events.js';

for (const [kind, payload, expected] of [
  ['cleanup-worker-error', { failureDetail: 'database unavailable' }, 'Cleanup worker failed: database unavailable'],
  ['cleanup-job-error', { jobId: 'cleanup-1', failureDetail: 'dirty worktree' }, 'Cleanup job cleanup-1 failed: dirty worktree'],
  ['cleanup-recovery-error', { message: 'recovery failed' }, 'Cleanup recovery failed: recovery failed'],
]) {
  test(`${kind} is visible to the user`, () => {
    const result = { textContent: '' };
    showCleanupError(kind, payload, result);
    assert.equal(result.textContent, expected);
  });
}

test('successful pending-input refresh clears only its own stale startup notice', () => {
  const pendingNotice = { textContent: 'Pending input status unavailable: OpenCode API returned HTTP 404 Not Found', hidden: false };
  assert.equal(clearNoticeIfStartsWith(pendingNotice, 'Pending input status unavailable:'), true);
  assert.deepEqual(pendingNotice, { textContent: '', hidden: true });

  const otherNotice = { textContent: 'Startup recovery failed: another issue', hidden: false };
  assert.equal(clearNoticeIfStartsWith(otherNotice, 'Pending input status unavailable:'), false);
  assert.deepEqual(otherNotice, { textContent: 'Startup recovery failed: another issue', hidden: false });
});
