import assert from "node:assert/strict";
import test from "node:test";
import {
  ownerSessionTabState,
  restoreOwnerSessionTabs,
} from "../src/views/workbench/sessionTabState.js";

const tab = (sessionId, ownerKey, selected = false) => ({
  sessionId,
  ownerKey,
  selected,
});

test("owner tab selection uses remembered, selected, then insertion order without crossing owners", () => {
  const entries = [
    tab("b", "workspace:b", true),
    tab("a1", "workspace:a"),
    tab("a2", "workspace:a", true),
    tab("tool", "workspace:a"),
    tab("proposal-id", "proposal"),
  ];
  for (const [ownerKey, preferred, expected] of [
    ["workspace:a", "tool", "tool"],
    ["workspace:a", "a1", "a1"],
    ["workspace:a", "stale", "a2"],
    ["workspace:b", "a1", "b"],
    ["proposal", undefined, "proposal-id"],
    [null, "a1", undefined],
    ["workspace:empty", "a1", undefined],
  ]) {
    const result = ownerSessionTabState(entries, ownerKey, preferred);
    assert.equal(result.selectedId, expected);
    assert.deepEqual(
      result.entries
        .filter((entry) => entry.visible)
        .map((entry) => entry.sessionId),
      entries
        .filter((entry) => ownerKey && entry.ownerKey === ownerKey)
        .map((entry) => entry.sessionId),
    );
    assert.deepEqual(
      result.entries
        .filter((entry) => entry.selected)
        .map((entry) => entry.sessionId),
      expected ? [expected] : [],
    );
  }
  assert.equal(
    ownerSessionTabState(
      entries.map((entry) => ({ ...entry, selected: false })),
      "workspace:a",
      "stale",
    ).selectedId,
    "a1",
  );
  assert.equal(
    entries[2].selected,
    true,
    "derivation does not mutate its inputs",
  );
});

test("tabless Quick Requests keep their exact selected ID and hide all Workspace/proposal tabs", () => {
  const entries = [
    tab("a", "workspace:a", true),
    tab("proposal-id", "proposal"),
  ];
  const result = ownerSessionTabState(
    entries,
    "task:request",
    "exact-request-session",
    true,
  );
  assert.equal(result.selectedId, "exact-request-session");
  assert.ok(result.entries.every((entry) => !entry.visible && !entry.selected));
  assert.equal(
    ownerSessionTabState(entries, "task:request", undefined, true).selectedId,
    undefined,
  );
});

test("closing a selected tab falls back in insertion order; other owners and final-tab emptiness stay distinct", () => {
  const entries = [
    tab("other", "workspace:b", true),
    tab("first", "workspace:a"),
    tab("selected", "workspace:a", true),
  ];
  const remaining = entries.filter((entry) => entry.sessionId !== "selected");
  assert.equal(
    ownerSessionTabState(remaining, "workspace:a", "selected").selectedId,
    "first",
  );
  assert.equal(
    ownerSessionTabState(remaining, "workspace:b", "other").selectedId,
    "other",
  );
  assert.equal(
    ownerSessionTabState(
      remaining.filter((entry) => entry.sessionId !== "first"),
      "workspace:a",
      "first",
    ).selectedId,
    undefined,
  );
});

function restoreFixture({
  preferred,
  open = [],
  owner = { type: "workspace", id: "a" },
} = {}) {
  const key = `${owner.type}:${owner.id}`;
  const calls = [];
  const session = (id, overrides = {}) => ({
    openCodeSessionId: id,
    owner: { owner_type: owner.type, owner_id: owner.id },
    ...overrides,
  });
  const state = { currentOwner: key, tabs: [] };
  const deps = {
    owner,
    sessions: [
      session("first"),
      session("second"),
      session("missing", { lastKnownStatus: "missing" }),
      session("foreign-type", {
        owner: { owner_type: "task", owner_id: owner.id },
      }),
      session("foreign-id", {
        owner: { owner_type: owner.type, owner_id: "b" },
      }),
    ],
    selectedSessionByOwner: new Map(preferred ? [[key, preferred]] : []),
    openSessions: new Set(open),
    repositoryToolTerminals: new Set(),
    getTabEntries: () => state.tabs,
    getSelectedOwnerKey: () => state.currentOwner,
    showSession: async (id) => {
      calls.push(["show", id]);
      deps.selectedSessionByOwner.set(key, id);
    },
  };
  return { deps, state, calls, key };
}

test("restore filters exact owners/missing records, preserves order and captured preferred/open/first selection", async () => {
  for (const [options, expected] of [
    [{ preferred: "second", open: ["first"] }, "second"],
    [{ preferred: "missing", open: ["second"] }, "second"],
    [{ preferred: "foreign-type" }, "first"],
    [{}, "first"],
  ]) {
    const { deps, calls } = restoreFixture(options);
    await restoreOwnerSessionTabs(deps);
    assert.deepEqual(calls, [
      ["show", "first"],
      ["show", "second"],
      ["show", expected],
    ]);
  }
  const { deps, calls } = restoreFixture({
    owner: { type: "task", id: "request" },
  });
  deps.sessions = [
    {
      openCodeSessionId: "wrong-owner-type",
      owner: { owner_type: "workspace", owner_id: "request" },
    },
    {
      openCodeSessionId: "exact-request-id",
      owner: { owner_type: "task", owner_id: "request" },
    },
  ];
  await restoreOwnerSessionTabs(deps);
  assert.deepEqual(calls, [
    ["show", "exact-request-id"],
    ["show", "exact-request-id"],
  ]);
});

test("restore reselects a remembered tool through its explicit action, or falls back if closed or foreign", async () => {
  for (const toolState of ["present", "closed", "foreign"]) {
    const { deps, state, calls, key } = restoreFixture({ preferred: "tool" });
    deps.repositoryToolTerminals.add("tool");
    state.tabs =
      toolState === "closed"
        ? []
        : [
            {
              ...tab("tool", toolState === "foreign" ? "workspace:b" : key),
              onSelect: () => calls.push(["select-tool", "tool"]),
            },
          ];
    await restoreOwnerSessionTabs(deps);
    assert.deepEqual(calls, [
      ["show", "first"],
      ["show", "second"],
      toolState === "present" ? ["select-tool", "tool"] : ["show", "first"],
    ]);
  }
});

test("restore stops after an in-flight restore when owner changes, without selecting a tool or another tracked session", async () => {
  for (const pauseAt of ["first", "second"]) {
    const { deps, state, calls, key } = restoreFixture({ preferred: "tool" });
    deps.repositoryToolTerminals.add("tool");
    state.tabs = [
      {
        ...tab("tool", key),
        onSelect: () => assert.fail("stale tool selection"),
      },
    ];
    let release, reached;
    const paused = new Promise((resolve) => {
      reached = resolve;
    });
    deps.showSession = async (id) => {
      calls.push(["show", id]);
      if (id === pauseAt)
        await new Promise((resolve) => {
          release = resolve;
          reached();
        });
    };
    const restoring = restoreOwnerSessionTabs(deps);
    await paused;
    state.currentOwner = "task:quick-request";
    release();
    await restoring;
    assert.deepEqual(
      calls,
      pauseAt === "first"
        ? [["show", "first"]]
        : [
            ["show", "first"],
            ["show", "second"],
          ],
    );
    calls.length = 0;
    await restoreOwnerSessionTabs(deps);
    assert.deepEqual(calls, []);
  }
});

test("restore stops on failure and leaves error reporting to the owner-guarded adapter", async () => {
  const { deps, calls } = restoreFixture();
  deps.showSession = async (id) => {
    calls.push(id);
    throw new Error("attach failed");
  };
  await assert.rejects(restoreOwnerSessionTabs(deps), /attach failed/);
  assert.deepEqual(calls, ["first"]);
});
