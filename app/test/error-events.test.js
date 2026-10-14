import assert from 'node:assert/strict';
import test from 'node:test';
import { showCleanupError } from '../src/error-events.js';

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
