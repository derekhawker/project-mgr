import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspaceCreationController,
  EMPTY_WORKSPACE_REPOSITORY,
} from "../src/features/new-work/modal/workspaceCreationController.js";

function setup(overrides = {}) {
  const calls = [];
  const deps = {
    getRepositoryChoice: () => "repo-1",
    getWorkspaceName: () => " Name ",
    getWorkspaceDescription: () => " Description ",
    invoke: "invoke",
    createWorkspace: async (...args) => {
      calls.push(["create", ...args]);
      return { id: "w", name: "Name" };
    },
    navigationData: () => ({ workspaces: [] }),
    refreshNavigation: async () => ({ workspaces: [{ id: "w" }] }),
    selectWorkspace: (...args) => calls.push(["select", ...args]),
    selectCreatedWorkspace: (_data, workspace) => workspace,
    setBusy: (value) => calls.push(["busy", value]),
    setError: (value) => calls.push(["error", value]),
    setNotice: (value) => calls.push(["notice", value]),
    setView: (value) => calls.push(["view", value]),
    closeModal: () => calls.push(["close"]),
    formatWorkspaceError: (label, error) => `${label}:${error.message}`,
    ...overrides,
  };
  return { controller: createWorkspaceCreationController(deps), calls };
}

test("registered repository creation directly links and selects without OpenCode", async () => {
  const { controller, calls } = setup();
  await controller.create({ preventDefault() {} });

  assert.deepEqual(
    calls.find(([key]) => key === "create"),
    ["create", "invoke", "Name", null, "repo-1"],
  );
  assert.deepEqual(calls.filter(([key]) => key === "select").length, 2);
  assert.equal(calls.some(([key]) => ["session", "prompt"].includes(key)), false);
  assert.ok(calls.some(([key, value]) => key === "view" && value === "closed"));
  assert.ok(calls.some(([key]) => key === "close"));
  assert.equal(calls.at(-1)[0], "busy");
  assert.equal(calls.at(-1)[1], false);
});

test("empty repository creation requires a description and sends it to Rust", async () => {
  const { controller, calls } = setup({
    getRepositoryChoice: () => EMPTY_WORKSPACE_REPOSITORY,
  });
  await controller.create();
  assert.deepEqual(
    calls.find(([key]) => key === "create"),
    ["create", "invoke", "Name", "Description", null],
  );
});

test("empty repository creation rejects a blank description before invoking Rust", async () => {
  const { controller, calls } = setup({
    getRepositoryChoice: () => EMPTY_WORKSPACE_REPOSITORY,
    getWorkspaceDescription: () => "  ",
  });
  await controller.create();
  assert.deepEqual(calls, [
    ["error", "A short description is required for an empty workspace."],
  ]);
});

test("command errors keep the form open and restore the busy state", async () => {
  const { controller, calls } = setup({
    createWorkspace: async () => {
      throw new Error("git failed");
    },
  });
  await controller.create();
  assert.ok(calls.some(([key, value]) => key === "error" && value === "Create workspace:git failed"));
  assert.equal(calls.some(([key]) => key === "close"), false);
  assert.deepEqual(calls.slice(-1), [["busy", false]]);
});

test("a navigation refresh failure does not retry or duplicate successful creation", async () => {
  const { controller, calls } = setup({
    refreshNavigation: async () => {
      throw new Error("refresh failed");
    },
  });
  await controller.create();
  assert.equal(calls.filter(([key]) => key === "create").length, 1);
  assert.ok(calls.some(([key, value]) => key === "notice" && value === "Workspace created; refresh navigation:refresh failed"));
  assert.ok(calls.some(([key]) => key === "close"));
});
