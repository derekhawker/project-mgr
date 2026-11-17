import test from "node:test";
import assert from "node:assert/strict";
import { createQuickRequestCreationController } from "../src/features/new-work/modal/quickRequestCreationController.js";

function setup(overrides = {}) {
  const calls = [];
  const deps = {
    getProposal: () => ({}),
    modelsReady: () => true,
    quickRequestDirectoryReady: () => true,
    getOriginalPrompt: () => " original\n",
    getStartingPrompt: () => " improved prompt",
    getSelectedModel: () => '{"providerId":"p","id":"m"}',
    getRepositoryId: () => "repo",
    proposalSessionId: () => "proposal",
    invoke: "invoke",
    submitResolvedQuickRequestFlow: async (args) => {
      calls.push(["submit", args]);
    },
    waitForTerminal: async () => calls.push(["terminal"]),
    onCreated: () => calls.push(["created"]),
    showSession: () => calls.push(["show"]),
    refreshRequests: async () => calls.push(["refresh"]),
    setCreateDisabled: (v) => calls.push(["disabled", v]),
    setOwnerSetupBusy: (v) => calls.push(["busy", v]),
    setProposalError: (v) => calls.push(["error", v]),
    clearOwnerSetupNotice: () => calls.push(["clearNotice"]),
    setProgressProposalSession: (v) => calls.push(["progressSession", v]),
    setNewWorkView: (v) => calls.push(["view", v]),
    clearProposal: () => calls.push(["clearProposal"]),
    closeModal: () => calls.push(["closeModal"]),
    closeProposalSession: async () => calls.push(["closeProposal"]),
    setOwnerStatus: (v) => calls.push(["status", v]),
    formatWorkspaceError: (label, error) => `${label}:${error.message}`,
    setAppNotice: (v) => calls.push(["notice", v]),
    clearPendingPromptAction: () => calls.push(["clearPending"]),
    syncPendingPrompt: () => calls.push(["sync"]),
    ...overrides,
  };
  return { controller: createQuickRequestCreationController(deps), calls };
}

test("passes exact prompt/model/repository and completes callbacks in order", async () => {
  const { controller, calls } = setup({
    submitResolvedQuickRequestFlow: async (args) => {
      calls.push(["submit", args]);
      await args.waitForTerminal();
      args.onCreated({});
      calls.push(["created"]);
      args.showSession();
    },
  });
  await controller.createQuickRequest();
  const args = calls.find(([key]) => key === "submit")[1];
  assert.equal(args.originalPrompt, " original\n");
  assert.equal(args.startingPrompt, " improved prompt");
  assert.deepEqual(args.model, { providerId: "p", id: "m" });
  assert.equal(args.repositoryId, "repo");
  assert.deepEqual(
    calls
      .filter(([key]) =>
        ["terminal", "created", "show", "refresh", "closeProposal"].includes(
          key,
        ),
      )
      .map(([key]) => key),
    ["terminal", "created", "created", "show", "closeProposal", "refresh"],
  );
  assert.deepEqual(calls.slice(-3), [
    ["busy", false],
    ["sync"],
    ["disabled", true],
  ]);
});

test("guards proposal, model readiness, and directory readiness without effects", async () => {
  for (const overrides of [
    { getProposal: () => null },
    { modelsReady: () => false },
    { quickRequestDirectoryReady: () => false },
  ]) {
    const { controller, calls } = setup(overrides);
    await controller.createQuickRequest();
    assert.deepEqual(calls, []);
  }
});

test("passes the chosen working directory to creation", async () => {
  const { controller, calls } = setup({ getDirectory: () => "/chosen folder" });
  await controller.createQuickRequest();
  assert.equal(
    calls.find(([key]) => key === "submit")[1].directory,
    "/chosen folder",
  );
});

test("failure reports error and always clears busy state, preserving retry availability", async () => {
  const { controller, calls } = setup({
    submitResolvedQuickRequestFlow: async () => {
      throw new Error("failed");
    },
  });
  await controller.createQuickRequest();
  assert.ok(
    calls.some(
      ([key, value]) => key === "error" && value === "Create work:failed",
    ),
  );
  assert.deepEqual(calls.slice(-3), [
    ["busy", false],
    ["sync"],
    ["disabled", false],
  ]);
});

test("durable startup failure keeps the modal open and retries the same request", async () => {
  const record = {
    task: { id: "qr-same-id", quickRequest: {} },
    session: { openCodeSessionId: "ses-same-id" },
  };
  const { controller, calls } = setup({
    submitResolvedQuickRequestFlow: async ({ onCreated }) => {
      onCreated(record);
      throw new Error("terminal attach failed");
    },
    retryResolvedQuickRequestFlow: async (args) => {
      calls.push(["retry", args]);
      return { promptSent: true };
    },
    setRecoveryRecord: (value) => calls.push(["recovery", value]),
    finishQuickRequestStartup: async (value) =>
      calls.push(["finish", value]),
    refreshRequests: async () => calls.push(["refresh"]),
  });

  await controller.createQuickRequest();
  assert.ok(calls.some(([key, value]) => key === "recovery" && value === record));
  assert.ok(calls.some(([key]) => key === "error"));
  assert.ok(!calls.some(([key, value]) => key === "closeModal" && value));

  await controller.retryQuickRequest();
  const retryArgs = calls.find(([key]) => key === "retry")[1];
  assert.equal(retryArgs.record, record);
  assert.ok(calls.some(([key, value]) => key === "finish" && value === record));
  assert.ok(calls.some(([key]) => key === "closeModal"));
  assert.deepEqual(calls.slice(-2), [["busy", false], ["sync"]]);
});
