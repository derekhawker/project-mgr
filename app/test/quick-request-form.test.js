import assert from "node:assert/strict";
import test from "node:test";
import { createSignal } from "solid-js";
import {
  createQuickRequestFormView,
  createQuickRequestSubmitHandler,
} from "../src/views/quick-requests/quickRequestForm.js";
import { task, session } from "./command-fixtures.js";

// Executes the production signal view, submit handler, flow and command adapter.
// Only transport/readiness collaborators are controlled; no DOM or GUI fixture.
const originalPrompt = "  Keep this exact text\n\tand trailing whitespace  \n";
const model = { providerId: "openai", id: "gpt-test" };
const serializedModel = JSON.stringify(model);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const view = createQuickRequestFormView();
  view.setPrompt(originalPrompt);
  const [error, setErrorMessage] = createSignal("previous error");
  const [selectedModel, setSelectedModel] = createSignal(serializedModel);
  const record = {
    task: { ...task, id: "quick-signal", quickRequest: null },
    session: { ...session, openCodeSessionId: "session-signal" },
    prompt: originalPrompt,
  };
  const calls = [];
  const order = [];
  const options = {
    view,
    getSelectedModel: selectedModel,
    setErrorMessage,
    isReady: () => true,
    waitForTerminal: async () => {
      order.push("terminal-ready");
    },
    invoke: async (name, payload) => {
      calls.push([name, payload]);
      order.push(name);
      if (name === "quick_request_create") return record;
      if (name === "quick_request_start_prompt") return null;
      assert.fail(`Unexpected command ${name}`);
    },
    showSession: async (id) => {
      order.push(`show:${id}`);
    },
    refreshRequests: async () => {
      order.push("refresh");
    },
    ...overrides,
  };
  const submit = createQuickRequestSubmitHandler(options);
  return {
    view,
    error,
    selectedModel,
    setSelectedModel,
    record,
    calls,
    order,
    submit,
  };
}

function submitEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

test(
  "production signal form snapshots exact prompt/model, waits for terminal, shows before send, clears before refresh and returns record",
  { timeout: 5000 },
  async () => {
    const terminal = deferred();
    const promptAccepted = deferred();
    const sending = deferred();
    const refreshing = deferred();
    const refreshStarted = deferred();
    const f = fixture({
      waitForTerminal: async () => {
        await terminal.promise;
        f.order.push("terminal-ready");
      },
      // Keep the actual command adapter; delay only its transport response.
      invoke: async (name, payload) => {
        f.calls.push([name, payload]);
        f.order.push(name);
        if (name === "quick_request_create") return f.record;
        sending.resolve();
        return promptAccepted.promise;
      },
      refreshRequests: async () => {
        assert.equal(f.view.getPrompt(), "");
        assert.equal(f.view.isBusy(), true);
        f.order.push("refresh");
        refreshStarted.resolve();
        await refreshing.promise;
      },
    });
    const event = submitEvent();
    const pending = f.submit(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.view.isBusy(), true);
    assert.equal(f.view.getPrompt(), originalPrompt);
    assert.equal(f.error(), "");
    assert.deepEqual(f.calls, []);
    const laterModel = JSON.stringify({
      providerId: "other",
      id: "later-choice",
    });
    f.setSelectedModel(laterModel);
    f.view.setPrompt("Edited while waiting for the terminal");
    terminal.resolve();
    await sending.promise;
    assert.equal(f.view.getPrompt(), "Edited while waiting for the terminal");
    assert.equal(f.view.isBusy(), true);
    promptAccepted.resolve(null);
    await refreshStarted.promise;
    refreshing.resolve();
    assert.equal(await pending, f.record);
    assert.equal(f.view.isBusy(), false);
    assert.equal(f.view.getPrompt(), "");
    assert.equal(f.selectedModel(), laterModel);
    assert.deepEqual(f.calls, [
      [
        "quick_request_create",
        { prompt: originalPrompt, model, repositoryId: null },
      ],
      ["quick_request_start_prompt", { requestId: "quick-signal", model }],
    ]);
    assert.deepEqual(f.order, [
      "terminal-ready",
      "quick_request_create",
      "show:session-signal",
      "quick_request_start_prompt",
      "refresh",
    ]);
  },
);

test(
  "production signal form retains text during deferred prompt failure, reports error and releases busy even if readiness changes",
  { timeout: 5000 },
  async () => {
    const response = deferred();
    const sending = deferred();
    let ready = true;
    const f = fixture({
      isReady: () => ready,
      invoke: async (name) => {
        if (name === "quick_request_create") return f.record;
        sending.resolve();
        return response.promise;
      },
      refreshRequests: () => assert.fail("failure must not refresh"),
    });
    const pending = f.submit(submitEvent());
    await sending.promise;
    assert.equal(f.error(), "");
    assert.equal(f.view.isBusy(), true);
    assert.equal(f.view.getPrompt(), originalPrompt);
    ready = false;
    response.reject(new Error("prompt delivery failed"));
    assert.equal(await pending, undefined);
    assert.equal(f.error(), "Error: prompt delivery failed");
    assert.equal(f.view.getPrompt(), originalPrompt);
    assert.equal(f.view.isBusy(), false);
  },
);

test("production signal form prevents native event but leaves state untouched while not ready", async () => {
  const f = fixture({ isReady: () => false });
  const event = submitEvent();
  await f.submit(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.view.isBusy(), false);
  assert.equal(f.view.getPrompt(), originalPrompt);
  assert.equal(f.error(), "previous error");
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.order, []);
});

test(
  "production signal form retains text when the pending terminal gate is cancelled before any command",
  { timeout: 5000 },
  async () => {
    const terminal = deferred();
    const f = fixture({ waitForTerminal: () => terminal.promise });
    const pending = f.submit(submitEvent());
    assert.equal(f.view.isBusy(), true);
    terminal.reject(
      new DOMException("Terminal startup cancelled", "AbortError"),
    );
    await pending;
    assert.equal(f.view.isBusy(), false);
    assert.equal(f.view.getPrompt(), originalPrompt);
    assert.equal(f.error(), "AbortError: Terminal startup cancelled");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.order, []);
  },
);

for (const stage of ["model", "create", "show"]) {
  test(`production signal form retains prompt and stops later work on ${stage} failure`, async () => {
    const f = fixture({
      ...(stage === "create"
        ? {
            invoke: async () => {
              throw new Error("create failed");
            },
          }
        : {}),
      ...(stage === "show"
        ? {
            showSession: async () => {
              throw new Error("show failed");
            },
          }
        : {}),
      refreshRequests: () => assert.fail("startup failure must not refresh"),
    });
    if (stage === "model") f.setSelectedModel("not JSON");
    await f.submit(submitEvent());
    assert.equal(f.view.getPrompt(), originalPrompt);
    assert.equal(f.view.isBusy(), false);
    assert.match(
      f.error(),
      stage === "model" ? /SyntaxError/ : new RegExp(`${stage} failed`),
    );
    assert.ok(!f.calls.some(([name]) => name === "quick_request_start_prompt"));
  });
}

test("production signal form keeps the accepted-prompt clear when list refresh fails", async () => {
  const f = fixture({
    refreshRequests: async () => {
      throw new Error("refresh failed");
    },
  });
  await f.submit(submitEvent());
  assert.equal(f.view.getPrompt(), "");
  assert.equal(f.view.isBusy(), false);
  assert.equal(f.error(), "Error: refresh failed");
  assert.equal(f.calls.at(-1)[0], "quick_request_start_prompt");
});
