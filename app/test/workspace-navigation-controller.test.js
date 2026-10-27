import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceNavigationController } from '../src/workspace-navigation-controller.js';

function setup({ workspace = null, quickRequest = null, catalog = [] } = {}) {
  const state = { data: null, navigation: null, selected: null, rows: null, busy: true, count: null, reviews: 0 };
  const controller = createWorkspaceNavigationController({
    getSelectedWorkspace: () => workspace,
    getSelectedQuickRequest: () => quickRequest,
    getRepositoryCatalog: () => catalog,
    getNavigationData: () => state.data,
    setNavigationData: (data) => { state.data = data; },
    setWorkspaceNavigation: (value) => { state.navigation = value; },
    setWorkspaceSelected: (value) => { state.selected = value; },
    setAttachedRepositoryRows: (value) => { state.rows = value; },
    setNavigationBusy: (value) => { state.busy = value; },
    setSelectedOwnerRepositoryCount: (value) => { state.count = value; },
    syncChangeReviewAvailability: () => { state.reviews += 1; },
  });
  return { controller, state };
}

test('navigation updates the selected Workspace and counts verified bindings only', () => {
  const workspace = { id: 'w1' };
  const { controller, state } = setup({ workspace });
  const data = { workspaceRepositories: [
    { workspaceId: 'w1', verificationStatus: 'verified' },
    { workspaceId: 'w1', verificationStatus: 'missing' },
    { workspaceId: 'w2', verificationStatus: 'verified' },
  ] };
  controller.renderNavigation(data);
  assert.equal(state.data, data);
  assert.deepEqual(state.navigation, { data, selected: workspace });
  assert.equal(state.selected, true);
  assert.equal(state.count, 1);
  assert.equal(state.reviews, 1);
  assert.equal(state.busy, false);
});

test('no-selection and Quick Request navigation do not recalculate review count', () => {
  for (const options of [{}, { workspace: { id: 'w1' }, quickRequest: { id: 'q1' } }]) {
    const { controller, state } = setup(options);
    const data = { workspaceRepositories: [] };
    controller.renderNavigation(data);
    assert.deepEqual(state.navigation, { data, selected: options.workspace || null });
    assert.equal(state.selected, false);
    assert.equal(state.busy, false);
    assert.equal(state.reviews, 0);
    assert.equal(state.count, null);
  }
});

test('attached repository rows include labels and checkout paths with catalog fallback', () => {
  const { controller, state } = setup({ catalog: [{ id: 'known', name: 'Known repo' }] });
  const data = { workspaceRepositories: [
    { workspaceId: 'w1', repositoryId: 'known', branch: 'main', verificationStatus: 'verified', checkoutPath: '/work/known' },
    { workspaceId: 'w1', repositoryId: 'gone', branch: 'topic', verificationStatus: 'unverified', checkoutPath: '/work/gone' },
    { workspaceId: 'w2', repositoryId: 'other', branch: 'main', verificationStatus: 'verified', checkoutPath: '/elsewhere' },
  ] };
  state.data = data;
  controller.renderAttachedRepositories('w1');
  assert.deepEqual(state.rows, [
    { label: 'Known repo · main · verified', checkoutPath: '/work/known' },
    { label: 'gone · topic · unverified', checkoutPath: '/work/gone' },
  ]);
});
