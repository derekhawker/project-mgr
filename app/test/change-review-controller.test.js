import test from "node:test";
import assert from "node:assert/strict";
import { createChangeReviewController } from "../src/views/workspace/change-review/changeReviewController.js";

function fixture({
  workspace = { id: "w1" },
  count = 1,
  quick = null,
  ticketViewerVisible = false,
  toolsOwner = null,
  load = async () => [],
} = {}) {
  const state = {};
  const calls = [];
  let repositoryToolsOwner = toolsOwner;
  let ticketViewer = ticketViewerVisible;
  const setters = [
    "Available",
    "Selected",
    "Disabled",
    "Visible",
    "Summary",
    "Error",
    "Repositories",
    "Loading",
    "Mode",
  ];
  const deps = Object.fromEntries(
    setters.map((name) => [
      `setChangeReview${name}`,
      (value) => {
        state[name] = value;
      },
    ]),
  );
  deps.getSelectedWorkspace = () => workspace;
  deps.getSelectedOwnerRepositoryCount = () => count;
  deps.getSelectedQuickRequest = () => quick;
  deps.isTicketViewerVisible = () => ticketViewer;
  deps.getRepositoryToolsOwner = () => repositoryToolsOwner;
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
    setToolsOwner: (value) => {
      repositoryToolsOwner = value;
    },
    setTicketViewerVisible: (value) => {
      ticketViewer = value;
    },
  };
}

test("availability and Docs refresh preserve unavailable guards and terminal transitions", async () => {
  const f = fixture({ workspace: null });
  f.controller.syncChangeReviewAvailability();
  assert.equal(f.state.Available, false);
  assert.equal(f.calls.includes("terminal"), true);
  assert.equal(f.state.Visible, false);
  assert.deepEqual(f.calls, ["terminal", "sync-tools"]);
  await f.controller.refreshDocsAvailability();
  assert.equal(await f.controller.handleChangeReviewClick(), undefined);
  assert.deepEqual(f.calls, ["terminal", "sync-tools"]);
});

test("Docs availability refresh uses the selected ticket workbench owner", async () => {
  const ticketOwner = {
    type: "workspace",
    id: "w1",
    ticketFilename: "ticket.md",
  };
  const f = fixture({ toolsOwner: ticketOwner });

  await f.controller.refreshDocsAvailability();

  assert.deepEqual(f.calls, [ticketOwner]);
});

test("Docs remains selected as availability refresh moves from Workspace to ticket workbench", async () => {
  const workspaceOwner = { type: "workspace", id: "w1" };
  const ticketOwner = {
    type: "workspace",
    id: "w1",
    ticketFilename: "ticket.md",
  };
  const f = fixture({ toolsOwner: workspaceOwner });
  await f.controller.refreshDocsAvailability();
  f.setToolsOwner(ticketOwner);
  await f.controller.refreshDocsAvailability();

  assert.deepEqual(f.calls, [workspaceOwner, ticketOwner]);
  assert.equal(f.calls.includes("terminal"), false);
});

test("unavailable workspace tools do not replace the ticket viewer with the owner terminal", () => {
  const f = fixture({
    workspace: { id: "w1" },
    count: 0,
    ticketViewerVisible: true,
  });
  f.controller.syncChangeReviewAvailability();

  assert.equal(f.state.Available, false);
  assert.equal(f.state.Visible, false);
  assert.deepEqual(f.calls, ["terminal", "sync-tools"]);
});

test("availability refresh does not close Docs when the workspace remains available", () => {
  const f = fixture();
  f.state.docsVisible = true;
  f.state.docsSelected = true;

  f.controller.syncChangeReviewAvailability();

  assert.equal(f.state.docsVisible, true);
  assert.equal(f.state.docsSelected, true);
  assert.equal(f.state.Visible, undefined);
  assert.ok(!f.calls.includes("terminal"));
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

test("loading is explicit and a stale failure cannot overwrite a newer review", async () => {
  const pending = [];
  const f = fixture({
    load: () =>
      new Promise((resolve, reject) => pending.push({ resolve, reject })),
  });
  const first = f.controller.handleChangeReviewClick();
  assert.equal(f.state.Loading, true);
  const second = f.controller.handleChangeReviewClick();
  pending[0].reject(new Error("old failure"));
  await first;
  assert.equal(f.state.Loading, true);
  assert.equal(f.state.Error, "");
  pending[1].resolve([{ files: [] }]);
  await second;
  assert.equal(f.state.Loading, false);
  assert.equal(f.state.Error, "");
  assert.equal(f.state.Summary, "1 repository · 0 files changed");
});

test("leaving review invalidates an in-flight error and clears loading", async () => {
  let reject;
  const f = fixture({
    load: () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  });
  const pending = f.controller.handleChangeReviewClick();
  f.controller.showOwnerTerminal();
  assert.equal(f.state.Loading, false);
  assert.equal(f.state.Visible, false);
  reject(new Error("late error"));
  await pending;
  assert.equal(f.state.Error, "");
  assert.equal(f.state.Disabled, false);
});
