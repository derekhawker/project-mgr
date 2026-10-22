const MAX_GROUPED_REPOSITORIES = 8;

function pathParts(path) {
  return path.split('/').filter(Boolean);
}

function commonParent(paths) {
  const parts = paths.map(pathParts);
  const shared = [];
  for (let index = 0; parts.every((entry) => entry[index] === parts[0][index]); index += 1) {
    if (parts[0][index] === undefined) break;
    shared.push(parts[0][index]);
  }
  return `/${shared.join('/')}${shared.length ? '/' : ''}`;
}

export function groupRepositoryDirectories(directories) {
  const rootGroups = new Map();
  for (const directory of directories) {
    const firstComponent = pathParts(directory.path)[0] || '';
    const group = rootGroups.get(firstComponent) || [];
    group.push(directory);
    rootGroups.set(firstComponent, group);
  }

  return [...rootGroups.values()].flatMap((group) => {
    if (group.length < 2) return group;
    const repositories = group.flatMap((directory) => directory.repositories);
    if (repositories.length > MAX_GROUPED_REPOSITORIES) return group;
    return [{ path: commonParent(group.map((directory) => directory.path)), repositories }];
  });
}
