import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceSessionFormController } from "../src/views/workbench/workspaceSessionFormController.js";
import { createWorkspaceSession } from "../src/services/shell.js";
import { session } from "./command-fixtures.js";

function setup(overrides = {}) {
  const calls = [];
  const controller = createWorkspaceSessionFormController({
    invoke: async (...args) => {
      calls.push(["invoke", ...args]);
      return {
        ...session,
        openCodeSessionId: "s1",
        owner: { owner_type: "workspace", owner_id: "w1" },
      };
    },
    createWorkspaceSession,
    getSelectedWorkspace: () => ({ id: "w1" }),
    isModelsReady: () => true,
    getPrompt: () => " exact prompt ",
    getSelectedModel: () => '{"providerId":"openai","id":"gpt-6-luna"}',
    showSession: async (id) => calls.push(["show", id]),
    setOwnerStatus: (value) => calls.push(["status", value]),
    formatWorkspaceError: (owner, error) =>
      `formatted:${owner}:${error.message}`,
    setSubmissionBusy: (value) => calls.push(["busy", value]),
    syncWorkspaceActionDisabled: () => calls.push(["sync"]),
    ...overrides,
  });
  return { controller, calls };
}

test("submits exact form values via command adapter and shows session before success status", async () => {
  const { controller, calls } = setup();
  let prevented = false;
  await controller.startWorkspaceSessionFromForm({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(calls, [
    ["busy", true],
    ["sync"],
    ["status", "Starting workspace session…"],
    [
      "invoke",
      "workspace_session_create",
      {
        workspaceId: "w1",
        prompt: " exact prompt ",
        model: { providerId: "openai", id: "gpt-6-luna" },
      },
    ],
    ["show", "s1"],
    ["status", "Workspace session started."],
    ["busy", false],
    ["sync"],
  ]);
});

test("readiness and workspace guards prevent command and busy transitions", async () => {
  for (const [overrides, message] of [
    [
      { isModelsReady: () => false },
      "Models are still loading; try again shortly.",
    ],
    [{ getSelectedWorkspace: () => null }, "Select an active workspace first."],
  ]) {
    const { controller, calls } = setup(overrides);
    await controller.startWorkspaceSessionFromForm({ preventDefault() {} });
    assert.deepEqual(calls, [["status", message]]);
  }
});

test("formats command and show-session failures and always clears busy state", async () => {
  for (const failAt of ["command", "show"]) {
    const error = new Error(`${failAt} failed`);
    const { controller, calls } = setup({
      invoke: async () => {
        if (failAt === "command") throw error;
        return {
          ...session,
          openCodeSessionId: "s1",
          owner: { owner_type: "workspace", owner_id: "w1" },
        };
      },
      showSession: async () => {
        if (failAt === "show") throw error;
      },
    });
    await controller.startWorkspaceSessionFromForm({ preventDefault() {} });
    assert(
      calls.some(
        (call) =>
          call[0] === "status" &&
          call[1] === `formatted:Workspace session:${failAt} failed`,
      ),
    );
    assert.deepEqual(calls.slice(-2), [["busy", false], ["sync"]]);
  }
});
