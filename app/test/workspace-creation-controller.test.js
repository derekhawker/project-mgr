import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceCreationController } from "../src/features/new-work/modal/workspaceCreationController.js";

function setup(overrides = {}) {
  const calls = [];
  const deps = {
    getProposal: () => ({ workspace: { intent: "intent" }, repositories: [] }),
    getProposalSessionId: () => "proposal",
    getSelectedModel: () => '{"providerId":"p","id":"m"}',
    getStartingPrompt: () => " start ",
    getWorkspaceName: () => " Name ",
    invoke: "invoke",
    createInitializedWorkspace: async (...args) => {
      calls.push(["create", ...args]);
      return {
        workspace: { id: "w" },
        setup: [],
        sessions: [{ openCodeSessionId: "s" }],
        sessionErrors: [],
      };
    },
    navigationData: () => ({ workspaceSessionContexts: [] }),
    refreshNavigation: async () => ({ refreshed: true }),
    selectWorkspace: (...args) => calls.push(["select", ...args]),
    selectCreatedWorkspace: (_data, workspace) => workspace,
    getCatalog: () => [],
    setProgress: (...args) => calls.push(["progress", ...args]),
    setProposalError: (v) => calls.push(["error", v]),
    setNewWorkView: (v) => calls.push(["view", v]),
    setProposalView: (fn) =>
      calls.push(["proposalView", fn({ createLabel: "Create" })]),
    showSession: async (id) => calls.push(["show", id]),
    workspaceSetupFailureDetails: () => "setup details",
    hideWorkspaceRepositoryIds: (v) => v,
    workspaceStartingPromptSession: (sessions) => sessions[0],
    shouldSubmitWorkspaceStartingPrompt: (v) => Boolean(v.trim()),
    submitNewWorkStartingPrompt: async (...args) =>
      calls.push(["prompt", ...args]),
    setOwnerStatus: (v) => calls.push(["ownerStatus", v]),
    clearProposal: () => calls.push(["clearProposal"]),
    closeModal: () => calls.push(["closeModal"]),
    closeProposalSession: async () => calls.push(["closeProposal"]),
    formatWorkspaceError: (label, error) => `${label}:${error.message}`,
    setOwnerSetupBusy: (v) => calls.push(["busy", v]),
    syncPendingPrompt: () => calls.push(["sync"]),
    setCreateDisabled: (v) => calls.push(["disabled", v]),
    clearError: () => calls.push(["clearError"]),
    clearOwnerSetupNotice: () => calls.push(["clearNotice"]),
    setProposalSessionForProgress: (v) => calls.push(["progressSession", v]),
    ...overrides,
  };
  return { controller: createWorkspaceCreationController(deps), calls };
}

test("successful creation selects workspace without opening a session or submitting a prompt", async () => {
  const { controller, calls } = setup();
  await controller.createWorkspace();
  assert.deepEqual(
    calls
      .filter(([key]) =>
        ["create", "show", "prompt", "busy", "sync", "disabled"].includes(key),
      )
      .map(([key]) => key),
    [
      "disabled",
      "busy",
      "create",
      "busy",
      "sync",
      "disabled",
    ],
  );
  assert.equal(calls.some(([key]) => key === "show" || key === "prompt"), false);
  assert.deepEqual(calls.slice(-3), [
    ["busy", false],
    ["sync"],
    ["disabled", true],
  ]);
});

test("pre-owner command failure reports create error and always restores busy state", async () => {
  const { controller, calls } = setup({
    createInitializedWorkspace: async () => {
      throw new Error("command");
    },
  });
  await controller.createWorkspace();
  assert.ok(
    calls.some(
      ([key, value]) => key === "error" && value === "Create work:command",
    ),
  );
  assert.deepEqual(calls.slice(-3), [
    ["busy", false],
    ["sync"],
    ["disabled", false],
  ]);
});

test("post-owner failure closes the create flow and keeps creation disabled", async () => {
  const { controller, calls } = setup({
    refreshNavigation: async () => {
      throw new Error("refresh");
    },
  });
  await controller.createWorkspace();
  assert.ok(
    calls.some(
      ([key, value]) =>
        key === "ownerStatus" && value === "Finish owner setup:refresh",
    ),
  );
  assert.deepEqual(calls.slice(-3), [
    ["busy", false],
    ["sync"],
    ["disabled", true],
  ]);
});
