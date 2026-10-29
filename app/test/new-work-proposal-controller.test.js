import test from "node:test";
import assert from "node:assert/strict";
import { createNewWorkProposalController } from "../src/views/new-work/newWorkProposalController.js";

function setup(overrides = {}) {
  const calls = [];
  let sessionId = "prior";
  const deps = {
    getOriginalPrompt: () => "  exact\nprompt  ",
    getRequestedType: () => "workspace",
    getSelectedModel: () => '{"providerId":"openai","id":"m"}',
    getProposalSessionId: () => sessionId,
    setProposalSessionId: (id) => {
      sessionId = id;
      calls.push(["session", id]);
    },
    invoke: "invoke",
    startNewWorkProposal: async (...args) => {
      calls.push(["start", ...args]);
      return { sessionId: "new" };
    },
    runNewWorkProposal: async (...args) => {
      calls.push(["run", ...args]);
      return { proposal: true };
    },
    refreshCatalog: async () => calls.push(["catalog"]),
    clearError: () => calls.push(["clear"]),
    setCaptureError: (v) => calls.push(["error", v]),
    setBusy: (v) => calls.push(["busy", v]),
    resetProgress: () => calls.push(["reset"]),
    setProgress: (...args) => calls.push(["progress", ...args]),
    setProposalMode: (v) => calls.push(["mode", v]),
    closePriorProposalSession: async () => calls.push(["close"]),
    renderProposal: async (...args) => calls.push(["render", ...args]),
    showReview: () => calls.push(["review"]),
    formatWorkspaceError: (label, error) => `${label}:${error.message}`,
    ...overrides,
  };
  return {
    controller: createNewWorkProposalController(deps),
    calls,
    setSession: (v) => {
      sessionId = v;
    },
  };
}

test("guards blank original prompt before state changes and preserves success ordering and exact values", async () => {
  const empty = setup({ getOriginalPrompt: () => " \n " });
  let prevented = false;
  await empty.controller.handleNewWorkCapture({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(empty.calls, []);

  const { controller, calls } = setup({
    getRequestedType: () => "quick_request",
  });
  await controller.handleNewWorkCapture({ preventDefault() {} });
  assert.deepEqual(calls, [
    ["clear"],
    ["busy", true],
    ["reset"],
    ["progress", "interpret", "Interpret request", "running"],
    ["close"],
    ["catalog"],
    ["start", "invoke", { providerId: "openai", id: "m" }],
    ["session", "new"],
    ["mode", true],
    ["run", "invoke", "new", "  exact\nprompt  ", undefined, "quick_request"],
    ["progress", "interpret", "Interpret request", "success"],
    ["render", { proposal: true }, "  exact\nprompt  "],
    ["review"],
    ["busy", false],
  ]);
});

test("captures failures and restores busy state for prior-session, model, start, run, and render failures", async () => {
  for (const [override, message] of [
    [
      {
        closePriorProposalSession: async () => {
          throw Error("close");
        },
      },
      "close",
    ],
    [
      { getSelectedModel: () => "{" },
      "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    ],
    [
      {
        startNewWorkProposal: async () => {
          throw Error("start");
        },
      },
      "start",
    ],
    [
      {
        runNewWorkProposal: async () => {
          throw Error("run");
        },
      },
      "run",
    ],
    [
      {
        renderProposal: async () => {
          throw Error("render");
        },
      },
      "render",
    ],
  ]) {
    const { controller, calls } = setup(override);
    await controller.handleNewWorkCapture({ preventDefault() {} });
    assert.deepEqual(calls.slice(-3), [
      [
        "progress",
        "interpret",
        "Interpret request",
        "failed",
        `${message.startsWith("Expected") ? "SyntaxError" : "Error"}: ${message}`,
      ],
      ["error", `Prepare proposal:${message}`],
      ["busy", false],
    ]);
  }
});

test("passes the explicitly chosen Quick Request directory to proposal generation", async () => {
  const { controller, calls } = setup({
    getRequestedType: () => "quick_request",
    getExplicitDirectory: () => "/chosen/directory",
  });
  await controller.handleNewWorkCapture({ preventDefault() {} });
  assert.equal(calls.find(([name]) => name === "run").at(-1), "/chosen/directory");
});
