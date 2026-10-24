import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerPromptTool } from '../src-tauri/plugins/workspace-coordinator/coordinator.mjs';

const workers = [
  { repositoryId: 'repo-a', repositoryName: 'Alpha', sessionId: 'ses-alpha' },
  { repositoryId: 'repo-b', repositoryName: 'Beta', sessionId: 'ses-beta' },
];

test('workspace coordinator queues a prompt to the exact tracked worker and returns admission only', async () => {
  const admitted = [];
  const tool = createWorkerPromptTool(workers, async (prompt) => admitted.push(prompt));
  const result = await tool({ repositoryId: 'repo-b', prompt: 'Implement the parser change.' });

  assert.deepEqual(admitted, [{
    sessionID: 'ses-beta',
    text: 'Implement the parser change.',
    delivery: 'queue',
  }]);
  assert.equal(result.content, 'Prompt admitted to the Beta worker. This does not mean the worker has completed it.');
  assert.doesNotMatch(result.content, /Implement the parser change/);
});

test('workspace coordinator rejects untracked repositories and blank prompts before admission', async () => {
  let calls = 0;
  const tool = createWorkerPromptTool(workers, async () => { calls += 1; });
  await assert.rejects(() => tool({ repositoryId: 'unknown', prompt: 'Do work' }), /No tracked worker/);
  await assert.rejects(() => tool({ repositoryId: 'repo-a', prompt: ' \n ' }), /cannot be blank/);
  assert.equal(calls, 0);
});

test('workspace coordinator rejects ambiguous persisted worker maps', () => {
  assert.throws(() => createWorkerPromptTool([
    workers[0],
    { ...workers[1], repositoryId: 'repo-a' },
  ], async () => {}), /unique repositories/);
  assert.throws(() => createWorkerPromptTool([
    { ...workers[0], sessionId: '' },
    workers[1],
  ], async () => {}), /exact session IDs/);
});
