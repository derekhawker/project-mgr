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
const LARGE_CATALOG_THRESHOLD = 20;
const compareNames = (left, right) =>
  left.localeCompare(right, undefined, { sensitivity: "base" }) ||
  left.localeCompare(right);

function groupRepositoryRoots(directories, preserveRoots) {
  if (preserveRoots) return directories;
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
  const totalEntries = directories.reduce(
    (count, directory) => count + directory.repositories.length,
    0,
  );
  const preserveStructure = totalEntries > LARGE_CATALOG_THRESHOLD;
  const roots = groupRepositoryRoots(directories, preserveStructure).map((directory) => {
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
      children.push({
        kind: "repository",
        name: entry.repository.name,
        entry,
      });
    }

    root.children = preserveStructure
      ? root.children
      : collapseSmallDirectoryGroups(root.children);
    sortSiblings(root.children);
    return root;
  });
  roots.sort((left, right) => compareNames(left.name, right.name));
  return roots;
}

function sortSiblings(nodes) {
  nodes.sort((left, right) => compareNames(left.name, right.name));
  for (const node of nodes) {
    if (node.kind === "directory") sortSiblings(node.children);
  }
}

export function filterRepositoryDirectoryTree(tree, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return tree;

  function filterNodes(nodes) {
    return nodes.flatMap((node) => {
      if (node.kind === "repository") {
        const repository = node.entry.repository;
        return `${repository.name}\n${repository.repositoryPath}`
          .toLocaleLowerCase()
          .includes(needle)
          ? [node]
          : [];
      }
      const children = filterNodes(node.children);
      return children.length ? [{ ...node, children }] : [];
    });
  }

  return tree.flatMap((root) => {
    const children = filterNodes(root.children);
    return children.length ? [{ ...root, children }] : [];
  });
}
