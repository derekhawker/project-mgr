import test from "node:test";
import assert from "node:assert/strict";
import { createChangeReviewController } from "../src/views/change-review/changeReviewController.js";

function fixture({
  workspace = { id: "w1" },
  count = 1,
  quick = null,
  load = async () => [],
} = {}) {
  const state = {};
  const calls = [];
  const setters = [
    "Available",
    "Selected",
    "Disabled",
    "Visible",
    "Summary",
    "Error",
    "Repositories",
    "Mode",
    "DocsButtonSelected",
    "SelectedOwnerVisible",
  ];
  const deps = Object.fromEntries(
    setters.map((name) => [
      `setChangeReview${name}`,
      (value) => {
        state[name] = value;
      },
    ]),
  );
  deps.setDocsButtonSelected = (value) => {
    state.docsSelected = value;
  };
  deps.setSelectedOwnerVisible = (value) => {
    state.ownerVisible = value;
  };
  deps.getSelectedWorkspace = () => workspace;
  deps.getSelectedOwnerRepositoryCount = () => count;
  deps.getSelectedQuickRequest = () => quick;
  deps.getRepositoryToolsOwner = () => null;
  deps.syncRepositoryToolsAvailability = () => calls.push("sync-tools");
  deps.invoke = () => {};
  deps.loadChangeReview = load;
  deps.docsController = {
    showTerminal: () => calls.push("terminal"),
    refresh: async (owner) => calls.push(owner),
  };
  return {
    state,
    calls,
    deps,
    controller: createChangeReviewController(deps),
    setWorkspace: (value) => {
      workspace = value;
    },
  };
}

test("availability and Docs refresh preserve unavailable guards and terminal transitions", async () => {
  const f = fixture({ workspace: null });
  f.controller.syncChangeReviewAvailability();
  assert.equal(f.state.Available, false);
  assert.equal(f.state.docsSelected, false);
  assert.equal(f.state.Visible, false);
  assert.deepEqual(f.calls, ["terminal", "sync-tools"]);
  await f.controller.refreshDocsAvailability();
  assert.equal(await f.controller.handleChangeReviewClick(), undefined);
  assert.deepEqual(f.calls, ["terminal", "sync-tools"]);
});

test("successful load updates exact summary and repository signals", async () => {
  const rows = [{ files: [{}, {}] }];
  const f = fixture({
    load: async (...args) => {
      fArgs = args;
      return rows;
    },
  });
  let fArgs;
  await f.controller.handleChangeReviewClick();
  assert.deepEqual(fArgs.slice(1), ["workspace", "w1"]);
  assert.equal(f.state.Summary, "1 repository · 2 files changed");
  assert.equal(f.state.Repositories, rows);
  assert.equal(f.state.Disabled, false);
  assert.equal(
    f.state.Mode,
    undefined,
    "opening review must not reset the saved layout",
  );
  assert.equal(f.state.Visible, true);
  assert.equal(f.state.ownerVisible, false);
});

test("stale owner response does not replace displayed results", async () => {
  let resolve;
  const f = fixture({
    load: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = f.controller.handleChangeReviewClick();
  f.setWorkspace({ id: "w2" });
  resolve([{ files: [] }]);
  await pending;
  assert.deepEqual(f.state.Repositories, []);
  assert.equal(f.state.Disabled, false);
});

test("load failure reports the same summary and error and clears disabled in finally", async () => {
  const f = fixture({
    load: async () => {
      throw new Error("offline");
    },
  });
  await f.controller.handleChangeReviewClick();
  assert.equal(f.state.Summary, "Could not load changes: Error: offline");
  assert.equal(f.state.Error, "Could not load changes: Error: offline");
  assert.equal(f.state.Disabled, false);
});
