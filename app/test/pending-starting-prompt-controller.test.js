import test from "node:test";
import assert from "node:assert/strict";
import { createPendingStartingPromptController } from "../src/views/workbench/pendingStartingPromptController.js";

function setup(
  action = { type: "workspace", sessionId: "s1" },
  prompt = " text ",
  overrides = {},
) {
  const calls = [];
  let currentAction = action;
  let currentPrompt = prompt;
  const controller = createPendingStartingPromptController({
    getPendingAction: () => currentAction,
    getPromptText: () => currentPrompt,
    invoke: "invoke",
    showSession: async (id) => {
      calls.push(["show", id]);
    },
    submitStartingPrompt: async (...args) => {
      calls.push(["submit", ...args]);
    },
    setOwnerStatus: (value) => calls.push(["status", value]),
    formatError: (context, error) => `formatted:${context}:${error.message}`,
    getOwnerSetupNotice: () => "Setup note",
    clearPendingAction: () => {
      calls.push(["clear-action"]);
      currentAction = null;
    },
    setPromptVisible: (value) => calls.push(["visible", value]),
    setPromptText: (value) => {
      calls.push(["text", value]);
      currentPrompt = value;
    },
    setDisabled: (value) => calls.push(["disabled", value]),
    ...overrides,
  });
  return { controller, calls };
}

test("no pending action is a no-op", async () => {
  const { controller, calls } = setup(null);
  await controller.submitPendingStartingPrompt();
  assert.deepEqual(calls, []);
});

test("blank prompt is rejected without changing prompt or busy state", async () => {
  const { controller, calls } = setup(undefined, " \n ");
  await controller.submitPendingStartingPrompt();
  assert.deepEqual(calls, [["status", "Enter a starting prompt first."]]);
});

test("workspace success shows session then submits exact text and clears only after success", async () => {
  const { controller, calls } = setup();
  await controller.submitPendingStartingPrompt();
  assert.deepEqual(calls, [
    ["disabled", true],
    ["show", "s1"],
    ["submit", "invoke", { type: "workspace", sessionId: "s1" }, " text "],
    [
      "status",
      "Setup note Starting prompt submitted to the interactive terminal.",
    ],
    ["clear-action"],
    ["visible", false],
    ["text", ""],
    ["disabled", false],
  ]);
});

test("Quick Request success keeps its distinct status", async () => {
  const { controller, calls } = setup({
    type: "quick_request",
    sessionId: "q1",
  });
  await controller.submitPendingStartingPrompt();
  assert(
    calls.some(
      (call) =>
        call[0] === "status" &&
        call[1] === "Quick Request started in its interactive terminal.",
    ),
  );
  assert(
    calls.some(
      (call) =>
        call[0] === "submit" &&
        call[1] === "invoke" &&
        call[2].type === "quick_request" &&
        call[2].sessionId === "q1" &&
        call[3] === " text ",
    ),
  );
});

test("showSession and command failures retain pending action and text for retry", async () => {
  for (const failed of ["show", "command"]) {
    const error = new Error(`${failed} failed`);
    const { controller, calls } = setup(undefined, " retry me ", {
      showSession: async (id) => {
        calls.push(["show", id]);
        if (failed === "show") throw error;
      },
      submitStartingPrompt: async (...args) => {
        calls.push(["submit", ...args]);
        if (failed === "command") throw error;
      },
    });
    await controller.submitPendingStartingPrompt();
    assert(
      calls.some(
        (call) =>
          call[0] === "status" &&
          call[1] === `formatted:Submit starting prompt:${failed} failed`,
      ),
    );
    assert.equal(
      calls.some(
        ([name]) =>
          name === "clear-action" || name === "visible" || name === "text",
      ),
      false,
    );
    assert.deepEqual(calls.at(-1), ["disabled", false]);
  }
});

test("disabled state is reset in finally after failure", async () => {
  const { controller, calls } = setup(undefined, "prompt", {
    showSession: async () => {
      throw new Error("no");
    },
  });
  await controller.submitPendingStartingPrompt();
  assert.deepEqual(
    calls.filter(([name]) => name === "disabled"),
    [
      ["disabled", true],
      ["disabled", false],
    ],
  );
});
