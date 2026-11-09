import test from "node:test";
import assert from "node:assert/strict";
import { createDirectoriesController } from "../src/views/directories/directoriesController.js";

test("Directories controller refreshes repository/library state through production adapters", async () => {
  const calls = [];
  const state = {};
  const setters = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args) => {
          if (name === "repositoryLibraryPath") return "/library";
          if (name === "setRestoringLegacyArchives") {
            state.restoring = args[0](state.restoring || new Set());
            return;
          }
          state[name] = args[0];
        },
    },
  );
  const controller = createDirectoriesController({
    invoke: async (command, payload) => {
      calls.push([command, payload]);
      if (command === "repository_directory_page")
        return { directories: [{ path: "/code", repositories: [] }] };
      if (command === "repository_library_get") return "/library";
      if (command === "repository_catalog")
        return [
          {
            id: "repo-1",
            name: "Code",
            repositoryPath: "/code/repo",
            repositoryIdentity: "identity-1",
            purpose: null,
            purposeStatus: "unavailable",
            createdAt: 1,
            updatedAt: 1,
          },
        ];
      return [];
    },
    picker: async () => null,
    setRepositoryCatalog: (repositories) => {
      state.catalog = repositories;
    },
    refreshNavigation: async () => {},
    setters,
  });
  await controller.refreshDirectories();
  await controller.refreshCatalog();
  assert.equal(state.setRepositoryLibraryPath, "/library");
  assert.equal(state.setDirectoryGroups[0].path, "/code");
  assert.equal(state.catalog[0].id, "repo-1");
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "repository_directory_page",
      "repository_library_get",
      "repository_catalog",
    ],
  );
});

test("Directories remains open when initial loading fails and exposes a page-level error", async () => {
  const state = {};
  const setters = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args) => {
          if (name === "repositoryLibraryPath") return "/library";
          if (name === "selectedAttachRepository") return "";
          state[name] = args[0];
        },
    },
  );
  const controller = createDirectoriesController({
    invoke: async () => {
      throw new Error("directory store unavailable");
    },
    picker: async () => null,
    getSelectedWorkspace: () => null,
    getNavigationData: () => ({}),
    getRepositoryCatalog: () => [],
    setRepositoryCatalog: () => {},
    refreshNavigation: async () => {},
    refreshDocsAvailability: () => {},
    setters,
  });

  await controller.showPage();

  assert.equal(state.setDirectoriesVisible, true);
  assert.equal(state.setRepositoryStatus, "");
  assert.match(
    state.setRepositoryError,
    /Load Repositories.*directory store unavailable/,
  );
  assert.equal(state.setNoSelectionVisible, false);
});

test("repository library path saves after five idle seconds or immediately on blur", async () => {
  const calls = [];
  const state = { path: "/library" };
  const scheduled = [];
  const canceled = new Set();
  let delay;
  const setters = {
    repositoryLibraryPath: () => state.path,
    setRepositoryLibraryPath: (path) => {
      state.path = path;
    },
    setRepositoryLibraryError: (error) => {
      state.error = error;
    },
    setRepositoryLibraryStatus: (status) => {
      state.status = status;
    },
  };
  const controller = createDirectoriesController({
    invoke: async (command, payload) => {
      calls.push([command, payload]);
      if (command === "repository_library_set") return payload.path;
    },
    picker: async () => null,
    getSelectedWorkspace: () => null,
    getNavigationData: () => ({}),
    getRepositoryCatalog: () => [],
    setRepositoryCatalog: () => {},
    refreshNavigation: async () => {},
    refreshDocsAvailability: () => {},
    setters,
    scheduleTimeout: (callback, milliseconds) => {
      delay = milliseconds;
      scheduled.push(callback);
      return scheduled.length - 1;
    },
    cancelTimeout: (timer) => {
      if (timer !== undefined) canceled.add(timer);
    },
  });

  controller.updateLibraryPath("/library/intermediate");
  controller.updateLibraryPath("/library/new");
  assert.equal(delay, 5000);
  assert.ok(canceled.has(0));
  assert.deepEqual(calls, []);
  scheduled[1]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    ["repository_library_set", { path: "/library/new" }],
  ]);

  controller.updateLibraryPath("/library/final");
  await controller.saveLibrary();
  assert.ok(canceled.has(2));
  assert.deepEqual(calls.at(-1), [
    "repository_library_set",
    { path: "/library/final" },
  ]);
  assert.equal(state.status, "Repository library location saved.");
});

test("bulk repository deletion confirms once, soft-deletes selected IDs, and refreshes the page", async () => {
  const calls = [];
  const state = {};
  let allowDelete = false;
  const setters = new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args) => {
          if (name === "repositoryLibraryPath") return "/library";
          if (name === "selectedAttachRepository") return "";
          state[name] = args[0];
        },
    },
  );
  const controller = createDirectoriesController({
    invoke: async (command, payload) => {
      calls.push([command, payload]);
      if (command === "repository_directory_page") return { directories: [] };
      if (command === "repository_library_get") return "/library";
      if (command === "repository_catalog") return [];
      return null;
    },
    picker: async () => null,
    getSelectedWorkspace: () => null,
    getNavigationData: () => ({}),
    getRepositoryCatalog: () => [],
    setRepositoryCatalog: () => {},
    refreshNavigation: async () => calls.push(["navigation"]),
    refreshDocsAvailability: () => {},
    confirm: (message) => {
      calls.push(["confirm", message]);
      return allowDelete;
    },
    setters,
  });

  await controller.deleteRepositories(["repo-a", "repo-b"]);
  assert.deepEqual(calls, [
    [
      "confirm",
      "Delete 2 selected repositories from the catalog? They will stay hidden when scanned again. Their files and existing workspace associations will remain.",
    ],
  ]);

  calls.length = 0;
  allowDelete = true;
  await controller.deleteRepositories(["repo-a", "repo-b"]);

  assert.deepEqual(calls, [
    [
      "confirm",
      "Delete 2 selected repositories from the catalog? They will stay hidden when scanned again. Their files and existing workspace associations will remain.",
    ],
    ["repository_soft_delete_many", { repositoryIds: ["repo-a", "repo-b"] }],
    ["repository_directory_page", undefined],
    ["repository_library_get", undefined],
    ["repository_catalog", undefined],
    ["navigation"],
  ]);
  assert.equal(state.setRepositoryError, "");
});
