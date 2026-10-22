import assert from 'node:assert/strict';
import test from 'node:test';
import { groupRepositoryDirectories } from '../src/directory-groups.js';

const entry = (path, ...names) => ({
  path,
  repositories: names.map((name) => ({ repository: { name, repositoryPath: `${path}/${name}` }, enabled: true })),
});

test('groups the current programs scan roots at their shortest shared parent and keeps /tmp separate', () => {
  const directories = [
    entry('/home/derekhawker/programs/js-ui-lib', 'js-ui-lib'),
    entry('/home/derekhawker/programs/opencode'),
    entry('/home/derekhawker/programs/opencode/custom-tools', 'custom-tools'),
    entry('/home/derekhawker/programs/opencode/project-mgr', 'project-mgr'),
    entry('/home/derekhawker/programs/simgame'),
    entry('/home/derekhawker/programs/simgame/rust-main', 'rust-main'),
    entry('/home/derekhawker/programs/web/javascript/graph-rendering', 'graph-rendering'),
    entry('/tmp/opencode', 'repo-a', 'repo-b'),
  ];

  assert.deepEqual(groupRepositoryDirectories(directories), [
    {
      path: '/home/derekhawker/programs/',
      repositories: directories.slice(0, 7).flatMap(({ repositories }) => repositories),
    },
    directories[7],
  ]);
});

test('keeps scan directories separate when their shared parent contains more than eight repos', () => {
  const directories = [
    entry('/home/user/programs/one', 'a', 'b', 'c'),
    entry('/home/user/programs/two', 'd', 'e', 'f'),
    entry('/home/user/programs/three', 'g', 'h', 'i'),
    entry('/tmp/other', 'other'),
  ];

  assert.deepEqual(groupRepositoryDirectories(directories), directories);
});
