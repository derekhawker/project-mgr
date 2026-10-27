import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceLifecycleController } from '../src/workspace-lifecycle-controller.js';

function setup(status = 'active', commandError) {
  const calls = [];
  let selected = { id: 'w1', status };
  const result = { id: 'w1', status: status === 'active' ? 'completed' : 'active' };
  const controller = createWorkspaceLifecycleController({
    getSelectedWorkspace: () => selected, setSelectedWorkspace: (value) => { selected = value; calls.push(['selected', value]); },
    completeWorkspace: async (...args) => { calls.push(['complete', ...args]); if (commandError) throw commandError; return result; },
    reactivateWorkspace: async (...args) => { calls.push(['reactivate', ...args]); if (commandError) throw commandError; return result; },
    invoke: 'invoke', setOwnerStatus: (value) => calls.push(['status', value]),
    refreshNavigation: async () => { calls.push(['refresh']); }, selectWorkspace: (...args) => calls.push(['select', ...args]),
    getNavigationData: () => 'navigation', formatWorkspaceError: (...args) => `formatted:${args[0]}:${args[1]}`,
  });
  return { controller, calls, get selected() { return selected; }, result };
}

test('workspace lifecycle guards reject missing/ineligible states without invoking commands', async () => {
  const completed = setup('completed'); await completed.controller.handleCompleteWorkspace();
  assert.deepEqual(completed.calls, []);
  const active = setup('active'); await active.controller.handleReactivateWorkspace();
  assert.deepEqual(active.calls, []);
});

test('completion sends adapter/id and updates selection, message, then refreshes and reselects', async () => {
  const { controller, calls, result } = setup(); await controller.handleCompleteWorkspace();
  assert.deepEqual(calls, [['complete', 'invoke', 'w1'], ['selected', result], ['status', 'Workspace completed; homes, history, and running sessions were preserved.'], ['refresh'], ['select', result, 'navigation']]);
});

test('reactivation errors preserve selected workspace and report formatted message', async () => {
  const error = new Error('failed'); const { controller, calls, selected } = setup('completed', error);
  await controller.handleReactivateWorkspace();
  assert.equal(calls[0][0], 'reactivate'); assert.deepEqual(calls.at(-1), ['status', 'formatted:Reactivate workspace:Error: failed']);
  assert.equal(calls.some(([name]) => name === 'refresh'), false); assert.equal(selected.status, 'completed');
});
