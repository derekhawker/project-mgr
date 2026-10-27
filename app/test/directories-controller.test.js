import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectoriesController } from '../src/directories-controller.js';

test('Directories controller refreshes repository/library state through production adapters', async () => {
  const calls = [];
  const state = {};
  const setters = new Proxy({}, { get: (_target, name) => (...args) => {
    if (name === 'repositoryLibraryPath') return '/library';
    if (name === 'selectedAttachRepository') return 'repo-1';
    if (name === 'setRestoringLegacyArchives') { state.restoring = args[0](state.restoring || new Set()); return; }
    state[name] = args[0];
  } });
  const controller = createDirectoriesController({
    invoke: async (command, payload) => {
      calls.push([command, payload]);
      if (command === 'repository_directory_page') return { directories: [{ path: '/code', repositories: [] }] };
      if (command === 'repository_library_get') return '/library';
      if (command === 'repository_catalog') return [{ id: 'repo-1', name: 'Code', repositoryPath: '/code/repo', repositoryIdentity: 'identity-1', purpose: null, purposeStatus: 'unavailable', createdAt: 1, updatedAt: 1 }];
      return [];
    },
    picker: async () => null,
    getRepositoryCatalog: () => [], setRepositoryCatalog: (repositories) => { state.catalog = repositories; },
    getSelectedWorkspace: () => null,
    getNavigationData: () => ({}), refreshNavigation: async () => {},
    refreshDocsAvailability: () => {}, renderAttachedRepositories: () => {},
    setters,
  });
  await controller.refreshDirectories();
  await controller.refreshCatalog();
  assert.equal(state.setRepositoryLibraryPath, '/library');
  assert.equal(state.setDirectoryGroups[0].path, '/code');
  assert.deepEqual(state.setAttachRepositoryOptions, [{ id: 'repo-1', label: 'Code — /code/repo' }]);
  assert.equal(state.catalog[0].id, 'repo-1');
  assert.deepEqual(calls.map(([name]) => name), [
    'repository_directory_page', 'repository_library_get', 'repository_catalog',
  ]);
});
