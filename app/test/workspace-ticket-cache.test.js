import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceTicketCache } from "../src/views/workspace/tickets/workspaceTicketCache.js";

test("workspace selection reads the cache without invoking the Tauri loader", async () => {
  const calls = [];
  const cache = createWorkspaceTicketCache(async (...args) => {
    calls.push(args);
    return [{ filename: "ticket.md" }];
  });

  assert.equal(cache.get("workspace-1"), undefined);
  assert.deepEqual(calls, []);
  await cache.preload([
    { id: "workspace-1", kind: "regular", status: "active" },
    { id: "completed", kind: "regular", status: "completed" },
    { id: "quick", kind: "quick_requests", status: "active" },
  ]);
  await cache.preload([
    { id: "workspace-1", kind: "regular", status: "active" },
  ]);

  assert.deepEqual(calls, [
    ["workspace-1", false],
    ["workspace-1", true],
  ]);
  assert.deepEqual(cache.get("workspace-1"), [{ filename: "ticket.md" }]);
  assert.deepEqual(cache.get("workspace-1", true), [{ filename: "ticket.md" }]);
});

test("ticket-change invalidation reloads asynchronously and ignores stale requests", async () => {
  let resolveFirst;
  let calls = 0;
  const cache = createWorkspaceTicketCache(() => {
    calls += 1;
    if (calls === 1)
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    return Promise.resolve([{ filename: "new.md" }]);
  });
  const workspaces = [{ id: "workspace-1", kind: "regular", status: "active" }];
  const initialLoad = cache.load("workspace-1");
  await Promise.resolve();

  cache.invalidate();
  await cache.preload(workspaces);
  resolveFirst([{ filename: "stale.md" }]);
  await initialLoad;

  assert.deepEqual(cache.get("workspace-1"), [{ filename: "new.md" }]);
});
