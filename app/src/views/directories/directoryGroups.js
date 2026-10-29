function normalizePath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/{2,}/g, "/");
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function basename(path) {
  return normalizePath(path).split("/").filter(Boolean).at(-1) || path;
}

function pathParts(path) {
  return normalizePath(path).split("/").filter(Boolean);
}

function commonParent(paths) {
  const parts = paths.map(pathParts);
  const shared = [];
  for (
    let index = 0;
    parts.every((entry) => entry[index] === parts[0][index]);
    index += 1
  ) {
    if (parts[0][index] === undefined) break;
    shared.push(parts[0][index]);
  }
  const prefix = paths[0].replaceAll("\\", "/").startsWith("/") ? "/" : "";
  return `${prefix}${shared.join("/")}${shared.length ? "/" : ""}`;
}

function relativeSegments(rootPath, repositoryPath) {
  const root = normalizePath(rootPath);
  const repository = normalizePath(repositoryPath);
  const rootPrefix = root.endsWith("/") ? root : `${root}/`;
  const relative = repository.startsWith(rootPrefix)
    ? repository.slice(rootPrefix.length)
    : repository === root
      ? ""
      : basename(repository);
  return relative.split("/").filter(Boolean);
}

const MAX_COLLAPSED_REPOSITORIES = 5;

function groupRepositoryRoots(directories) {
  const rootGroups = new Map();
  for (const directory of directories) {
    const firstComponent = pathParts(directory.path)[0] || "";
    const group = rootGroups.get(firstComponent) || [];
    group.push(directory);
    rootGroups.set(firstComponent, group);
  }

  return [...rootGroups.values()].flatMap((group) => {
    if (group.length < 2) return group;
    const repositories = group.flatMap((directory) => directory.repositories);
    if (repositories.length > MAX_COLLAPSED_REPOSITORIES) return group;
    return [
      {
        path: normalizePath(commonParent(group.map(({ path }) => path))),
        repositories,
      },
    ];
  });
}

function repositoryCount(nodes) {
  return nodes.reduce(
    (count, node) =>
      count + (node.kind === "repository" ? 1 : repositoryCount(node.children)),
    0,
  );
}

function collapseSmallDirectoryGroups(nodes) {
  return nodes.flatMap((node) => {
    if (node.kind === "repository") return [node];

    const children = collapseSmallDirectoryGroups(node.children);
    if (repositoryCount(children) <= MAX_COLLAPSED_REPOSITORIES)
      return children;
    return [{ ...node, children }];
  });
}

export function buildRepositoryDirectoryTree(directories) {
  return groupRepositoryRoots(directories).map((directory) => {
    const root = {
      path: directory.path,
      name: basename(directory.path),
      children: [],
    };

    for (const entry of directory.repositories) {
      const segments = relativeSegments(
        directory.path,
        entry.repository.repositoryPath,
      );
      if (segments.length === 0) segments.push(entry.repository.name);

      let children = root.children;
      for (const segment of segments.slice(0, -1)) {
        let folder = children.find(
          (node) => node.kind === "directory" && node.name === segment,
        );
        if (!folder) {
          folder = { kind: "directory", name: segment, children: [] };
          children.push(folder);
        }
        children = folder.children;
      }
      children.push({ kind: "repository", entry });
    }

    root.children = collapseSmallDirectoryGroups(root.children);
    return root;
  });
}
