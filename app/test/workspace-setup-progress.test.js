import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hideWorkspaceRepositoryIds,
  workspaceProgressPresentation,
  workspaceSetupFailureDetails,
} from '../src/workspace-setup-progress.js';

const proposalRepositories = [{ repositoryId: 'repo-123', name: 'Custom Tools' }];
const repositoryCatalog = [{
  id: 'repo-123',
  name: 'custom-tools',
  repositoryPath: '/home/user/src/custom-tools',
}];

test('clone and terminal progress use repository name and source location, never the internal ID', () => {
  assert.deepEqual(workspaceProgressPresentation({
    key: 'clone:repo-123',
    label: 'Clone repository repo-123',
    status: 'failed',
    detail: 'Repository source changed or became dirty after review (repo-123).',
  }, proposalRepositories, repositoryCatalog), {
    label: 'Clone custom-tools — /home/user/src/custom-tools',
    detail: 'Repository source changed or became dirty after review (custom-tools — /home/user/src/custom-tools).',
  });
  assert.equal(workspaceProgressPresentation({ key: 'session:repo-123' }, proposalRepositories, repositoryCatalog).label,
    'Start custom-tools — /home/user/src/custom-tools terminal');
});

test('workspace setup failures and session summaries do not expose repository IDs', () => {
  const summary = workspaceSetupFailureDetails([{
    repositoryId: 'repo-123',
    errorDetail: 'Repository source changed or became dirty after review.',
  }], proposalRepositories, repositoryCatalog);
  assert.equal(summary, 'custom-tools — /home/user/src/custom-tools: Repository source changed or became dirty after review.');
  assert.doesNotMatch(hideWorkspaceRepositoryIds('Start terminal for repository repo-123: failed', proposalRepositories, repositoryCatalog), /repo-123/);
});
