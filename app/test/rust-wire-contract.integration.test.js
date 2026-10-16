import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { invokeCommand } from '../src/command-contract.js';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = resolve(appRoot, 'src-tauri/Cargo.toml');

test('actual Rust management and session DTOs satisfy frontend command result contracts', async () => {
  const child = spawnSync('cargo', [
    'run', '--quiet', '--manifest-path', manifest, '--features', 'integration-test-harnesses',
    '--bin', 'wire-contract-harness',
  ], { cwd: appRoot, encoding: 'utf8', timeout: 120_000 });
  if (child.error) throw child.error;
  assert.equal(child.status, 0, child.stderr || 'Rust wire-contract harness failed');
  const wire = JSON.parse(child.stdout.trim());

  const cases = [
    ['opencode_model_default', undefined, wire.defaultModel],
    ['workspace_create', { request: { name: 'Wire', description: null } }, wire.workspace],
    ['quick_request_create', {
      request: {
        prompt: 'Wire prompt',
        model: { providerId: 'openai', id: 'gpt-6-luna' },
        repositoryId: null,
      },
    }, wire.quickRequest],
    ['quick_request_list', { request: { history: false } }, wire.quickRequestList],
    ['workspace_navigation', undefined, wire.workspaceNavigation],
    ['task_create', {
      request: {
        workspaceId: 'wire-workspace',
        model: { providerId: 'openai', id: 'gpt-6-luna' },
        name: 'Wire task',
        description: 'Wire task summary',
        repositoryIds: [],
      },
    }, wire.taskCreate],
    ['task_setup_status', { request: { taskId: 'wire-quick-request' } }, wire.taskSetupStatus],
    ['task_session_create', {
      request: {
        taskId: 'wire-quick-request',
        repositoryId: 'wire-repository',
        model: { providerId: 'openai', id: 'gpt-6-luna' },
      },
    }, wire.quickRequest.session],
    ['opencode_session_history', {
      request: { sessionId: 'ses_wire_contract', order: 'asc', limit: 10 },
    }, wire.sessionHistory],
    ['opencode_session_status', {
      request: { sessionId: 'ses_wire_contract' },
    }, wire.sessionStatus],
    ['opencode_session_reconcile', {
      request: { sessionId: 'ses_wire_contract', cursor: null },
    }, wire.sessionReconciliation],
    ['opencode_pending_inputs', {
      request: { sessionId: 'ses_wire_contract' },
    }, wire.pendingInputs],
    ['opencode_session_pending_inputs', {
      request: { sessionId: 'ses_wire_contract' },
    }, wire.pendingInputs],
  ];

  for (const [name, payload, result] of cases) {
    await assert.doesNotReject(
      () => invokeCommand(async (receivedName) => {
        assert.equal(receivedName, name);
        return result;
      }, name, payload),
      `Rust serialized result for ${name} must satisfy the checked-in frontend contract`,
    );
  }
});
