import test from "node:test";
import assert from "node:assert/strict";
import { createQuickRequestHistoryController } from "../src/views/quick-requests/quickRequestHistoryController.js";
import { createQuickRequestSelection } from "../src/views/quick-requests/quickRequestSelection.js";

test("history controller preserves list filtering, open, delete ownership, and destination callbacks", async () => {
  const calls = [],
    state = { selected: { id: "qr-1" }, query: "  ALPHA " };
  const records = [
    {
      task: { id: "qr-1", workspaceId: "quick" },
      session: { openCodeSessionId: "ses-1" },
      prompt: "Alpha request",
    },
    { task: { id: "qr-2", workspaceId: "quick" }, prompt: "Beta request" },
  ];
  const controller = createQuickRequestHistoryController({
    invoke: () => {},
    listQuickRequests: async (_invoke, history) => {
      calls.push(["list", history]);
      return records;
    },
    restoreQuickRequest: async (_invoke, id) => ({
      task: { id },
      session: { openCodeSessionId: "ses-1" },
    }),
    deleteQuickRequest: async (_invoke, id) => calls.push(["delete", id]),
    getHistoryQuery: () => state.query,
    getNavigationData: () => ({ workspaces: [] }),
    getSelectedQuickRequest: () => state.selected,
    selectQuickRequest: (...args) => calls.push(["select", ...args]),
    showSession: async (id) => calls.push(["show", id]),
    forgetDeletedQuickRequestTerminal: async (id) => calls.push(["forget", id]),
    confirm: () => true,
    setAppNotice: (message) => calls.push(["notice", message]),
    formatWorkspaceError: (_context, error) => String(error),
    setRecentQuickRequests: (value) => {
      state.recent = value;
    },
    setAllQuickRequests: (value) => {
      state.all = value;
    },
    refreshNavigation: async () => calls.push(["navigation"]),
    clearSelectedRequest: () => calls.push(["clear"]),
    showHistoryDestination: () => calls.push(["destination"]),
  });
  await controller.refreshRequests();
  await controller.refreshRequests(true);
  assert.deepEqual(state.recent, records);
  assert.deepEqual(
    state.all.map(({ task }) => task.id),
    ["qr-1"],
  );
  await controller.openQuickRequestRecord(records[0]);
  await controller.deleteQuickRequestRecord(records[0], true);
  await controller.showQuickRequestList();
  assert.deepEqual(
    calls
      .filter(([name]) =>
        [
          "list",
          "select",
          "show",
          "delete",
          "forget",
          "clear",
          "navigation",
          "destination",
        ].includes(name),
      )
      .map(([name, value]) => [name, value]),
    [
      ["list", false],
      ["list", true],
      ["select", { id: "qr-1" }],
      ["show", "ses-1"],
      ["delete", "qr-1"],
      ["forget", "ses-1"],
      ["clear", undefined],
      ["list", false],
      ["list", true],
      ["navigation", undefined],
      ["list", true],
      ["destination", undefined],
    ],
  );
});

function selectionFixture() {
  const selection = createQuickRequestSelection();
  const records = ["qr-1", "qr-2"].map((id) => ({
    task: { id, workspaceId: "quick", quickRequest: true },
    session: { openCodeSessionId: `ses-${id}` },
  }));
  const state = {
    confirmed: true,
    deleteError: null,
    restoreError: null,
    notices: [],
    shown: [],
  };
  const controller = createQuickRequestHistoryController({
    invoke: () => {},
    listQuickRequests: async () => records,
    restoreQuickRequest: async (_invoke, id) => {
      if (state.restoreError) throw state.restoreError;
      return records.find(({ task }) => task.id === id);
    },
    deleteQuickRequest: async () => {
      if (state.deleteError) throw state.deleteError;
    },
    getHistoryQuery: () => "",
    getNavigationData: () => ({ workspaces: [] }),
    getSelectedQuickRequest: selection.selectedQuickRequest,
    selectQuickRequest: selection.setSelectedQuickRequest,
    showSession: async (id) => state.shown.push([selection.selectedId(), id]),
    forgetDeletedQuickRequestTerminal: async () => {},
    confirm: () => state.confirmed,
    setAppNotice: (message) => state.notices.push(message),
    formatWorkspaceError: (_context, error) => String(error),
    setRecentQuickRequests: () => {},
    setAllQuickRequests: () => {},
    refreshNavigation: async () => {},
    clearSelectedRequest: () => selection.setSelectedQuickRequest(null),
    showHistoryDestination: () => {},
  });
  return { selection, records, state, controller };
}

test("history opening and deletion share the production selected-request signal", async () => {
  const { selection, records, state, controller } = selectionFixture();
  await controller.openQuickRequestRecord(records[0]);
  await controller.openQuickRequestRecord(records[1]);
  assert.deepEqual(state.shown, [
    ["qr-1", "ses-qr-1"],
    ["qr-2", "ses-qr-2"],
  ]);
  assert.equal(selection.selectedQuickRequest(), records[1].task);
  await controller.showQuickRequestList();
  assert.equal(
    selection.selectedId(),
    "qr-2",
    "destination change retains the selected owner",
  );
  await controller.deleteQuickRequestRecord(records[0], true);
  assert.equal(
    selection.selectedId(),
    "qr-2",
    "deleting another request retains selection",
  );
  await controller.deleteQuickRequestRecord(records[1], true);
  assert.equal(selection.selectedQuickRequest(), null);
  assert.equal(selection.selectedId(), undefined);
  assert.deepEqual(state.notices, []);
});

test("bulk deletion confirms once, deletes only selected records, closes their terminals, and refreshes both lists", async () => {
  const calls = [];
  const records = ["qr-1", "qr-2", "qr-3"].map((id) => ({
    task: { id },
    session: { openCodeSessionId: `ses-${id}` },
  }));
  const controller = createQuickRequestHistoryController({
    invoke: () => {},
    listQuickRequests: async () => records,
    restoreQuickRequest: async () => {},
    deleteQuickRequest: async (_invoke, id) => calls.push(["delete", id]),
    getHistoryQuery: () => "",
    getNavigationData: () => ({ workspaces: [] }),
    getSelectedQuickRequest: () => null,
    selectQuickRequest: () => {},
    showSession: async () => {},
    forgetDeletedQuickRequestTerminal: async (id) => calls.push(["close", id]),
    confirm: (message) => {
      calls.push(["confirm", message]);
      return true;
    },
    setAppNotice: () => {},
    formatWorkspaceError: (_context, error) => String(error),
    setRecentQuickRequests: () => calls.push(["recent"]),
    setAllQuickRequests: () => calls.push(["all"]),
    refreshNavigation: async () => calls.push(["navigation"]),
    clearSelectedRequest: () => {},
    showHistoryDestination: () => {},
  });
  await controller.deleteQuickRequestRecords(["qr-1", "qr-3"]);
  assert.deepEqual(
    calls.map(([name, id]) => [name, id]),
    [
      [
        "confirm",
        "Delete 2 selected Quick Requests from the app? Their attached terminals will close, but the OpenCode conversations will remain in OpenCode.",
      ],
      ["delete", "qr-1"],
      ["close", "ses-qr-1"],
      ["delete", "qr-3"],
      ["close", "ses-qr-3"],
      ["recent", undefined],
      ["all", undefined],
      ["navigation", undefined],
    ],
  );
});

test("cancelled or rejected deletion and rejected restore retain the selected request", async () => {
  const { selection, records, state, controller } = selectionFixture();
  await controller.openQuickRequestRecord(records[0]);
  state.confirmed = false;
  await controller.deleteQuickRequestRecord(records[0], true);
  assert.equal(selection.selectedId(), "qr-1");
  state.confirmed = true;
  state.deleteError = new Error("delete failed");
  await controller.deleteQuickRequestRecord(records[0], true);
  assert.equal(selection.selectedId(), "qr-1");
  state.restoreError = new Error("restore failed");
  await controller.openQuickRequestRecord(records[1]);
  assert.equal(selection.selectedQuickRequest(), records[0].task);
  assert.deepEqual(state.notices, [
    "Error: delete failed",
    "Error: restore failed",
  ]);
});
