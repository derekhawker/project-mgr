import assert from "node:assert/strict";
import test from "node:test";
import { buildRepositoryDirectoryTree } from "../src/views/directories/directoryGroups.js";

const repository = (id, name, path, enabled = true) => ({
  repository: { id, name, repositoryPath: path },
  enabled,
});

test("groups small scan roots at their shared path without discarding the tree", () => {
  const directories = [
    {
      path: "/work/apps",
      repositories: [
        repository("repo-a", "alpha", "/work/apps/alpha"),
        repository("repo-b", "beta", "/work/apps/team/beta", false),
      ],
    },
    {
      path: "/work/tools",
      repositories: [repository("repo-c", "gamma", "/work/tools/gamma")],
    },
  ];

  const tree = buildRepositoryDirectoryTree(directories);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].path, "/work");
  assert.deepEqual(
    tree[0].children.map((node) => node.entry.repository.id),
    ["repo-a", "repo-b", "repo-c"],
  );
});

test("keeps a single Windows scan root at its own path", () => {
  const directories = [
    {
      path: "C:\\Work\\apps",
      repositories: [
        repository("repo-a", "alpha", "C:\\Work\\apps\\team\\alpha"),
      ],
    },
  ];

  const tree = buildRepositoryDirectoryTree(directories);
  assert.equal(tree[0].path, "C:\\Work\\apps");
  assert.equal(tree[0].children[0].entry.repository.id, "repo-a");
});

test("keeps crowded scan roots separate while continuing to process other branches", () => {
  const directories = [
    {
      path: "/work/apps",
      repositories: [
        repository("repo-a", "alpha", "/work/apps/alpha"),
        repository("repo-b", "beta", "/work/apps/team/beta"),
      ],
    },
    {
      path: "/work/tools",
      repositories: [
        repository("repo-c", "gamma", "/work/tools/gamma"),
        repository("repo-d", "delta", "/work/tools/delta"),
        repository("repo-e", "epsilon", "/work/tools/epsilon"),
        repository("repo-f", "zeta", "/work/tools/zeta"),
      ],
    },
    {
      path: "/tmp/opencode",
      repositories: [
        repository("tmp-a", "tmp-a", "/tmp/opencode/tmp-a"),
        repository("tmp-b", "tmp-b", "/tmp/opencode/tmp-b"),
      ],
    },
  ];
  const tree = buildRepositoryDirectoryTree(directories);

  assert.deepEqual(
    tree.map(({ path }) => path),
    ["/work/apps", "/work/tools", "/tmp/opencode"],
  );
});

test("keeps five repositories grouped at the shared scan-root directory", () => {
  const directories = [
    {
      path: "/home/user/programs/alpha",
      repositories: [
        repository("repo-a", "alpha", "/home/user/programs/alpha"),
      ],
    },
    {
      path: "/home/user/programs/beta",
      repositories: [repository("repo-b", "beta", "/home/user/programs/beta")],
    },
    {
      path: "/home/user/programs/gamma",
      repositories: [
        repository("repo-c", "gamma", "/home/user/programs/gamma"),
      ],
    },
    {
      path: "/home/user/programs/delta",
      repositories: [
        repository("repo-d", "delta", "/home/user/programs/delta"),
      ],
    },
    {
      path: "/home/user/programs/epsilon",
      repositories: [
        repository("repo-e", "epsilon", "/home/user/programs/epsilon"),
      ],
    },
  ];

  assert.equal(
    buildRepositoryDirectoryTree(directories)[0].path,
    "/home/user/programs",
  );
});

test("keeps programs and temporary scan-root groups at their data directories", () => {
  const directories = [
    {
      path: "/home/derek/programs/alpha",
      repositories: [repository("a", "alpha", "/home/derek/programs/alpha")],
    },
    {
      path: "/home/derek/programs/beta",
      repositories: [repository("b", "beta", "/home/derek/programs/beta")],
    },
    {
      path: "/home/derek/programs/gamma",
      repositories: [repository("c", "gamma", "/home/derek/programs/gamma")],
    },
    {
      path: "/home/derek/programs/delta",
      repositories: [repository("d", "delta", "/home/derek/programs/delta")],
    },
    {
      path: "/home/derek/programs/epsilon",
      repositories: [
        repository("e", "epsilon", "/home/derek/programs/epsilon"),
      ],
    },
    {
      path: "/tmp/opencode",
      repositories: [
        repository("tmp-a", "tmp-a", "/tmp/opencode/tmp-a"),
        repository("tmp-b", "tmp-b", "/tmp/opencode/tmp-b"),
      ],
    },
  ];

  assert.deepEqual(
    buildRepositoryDirectoryTree(directories).map(({ path }) => path),
    ["/home/derek/programs", "/tmp/opencode"],
  );
});

test("collapses a two-repository child directory into its saved scan-root group", () => {
  const directories = [
    {
      path: "/tmp/opencode",
      repositories: [
        repository("repo-root", "alacritty-026", "/tmp/opencode/alacritty-026"),
        repository(
          "repo-a",
          "repo-a",
          "/tmp/opencode/multi-repo-agents.cxtTik/repo-a",
        ),
        repository(
          "repo-b",
          "repo-b",
          "/tmp/opencode/multi-repo-agents.cxtTik/repo-b",
        ),
      ],
    },
  ];

  const [root] = buildRepositoryDirectoryTree(directories);
  assert.equal(root.path, "/tmp/opencode");
  assert.deepEqual(
    root.children.map((node) => node.entry.repository.id),
    ["repo-root", "repo-a", "repo-b"],
  );
});

test("collapses small child groups but keeps child directories with more than five repos", () => {
  const repositories = [
    ...Array.from({ length: 6 }, (_, index) =>
      repository(
        `large-${index}`,
        `large-${index}`,
        `/root/large/large-${index}`,
      ),
    ),
    repository("small-a", "small-a", "/root/small/small-a"),
    repository("small-b", "small-b", "/root/small/small-b"),
  ];

  const [root] = buildRepositoryDirectoryTree([
    { path: "/root", repositories },
  ]);

  assert.deepEqual(
    root.children.map((node) =>
      node.kind === "directory"
        ? `${node.name}:${node.children.length}`
        : node.entry.repository.id,
    ),
    ["large:6", "small-a", "small-b"],
  );
});
