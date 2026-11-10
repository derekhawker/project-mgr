import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync(
  new URL("../src-tauri/resources/ticket-worktree-plugin.js", import.meta.url),
  "utf8",
);
const source = template
  .replace(
    'import { Plugin } from "@opencode/plugin";',
    "const Plugin = { define: (definition) => definition };",
  )
  .replace("__PROJECT_MGR_EXECUTABLE__", JSON.stringify("/fixture/project-mgr"))
  .replace("__PROJECT_MGR_APP_DATA__", JSON.stringify("/fixture/app-data"));
const plugin = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("exports a V2 plugin definition with an id and setup function", () => {
  assert.equal(plugin.default.id, "project-mgr-ticket-worktree");
  assert.equal(typeof plugin.default.setup, "function");
});

test("plugin setup awaits and disposes its tool transform", async () => {
  let disposed = 0;
  const original = { execute: async () => ({ content: "ok" }) };
  const originalExecute = original.execute;
  const registry = new Map([["opencode_worktree_create", original]]);
  const dispose = await plugin.default.setup({
    tool: {
      transform: async (transform) => {
        transform({
          get: (name) => registry.get(name),
          update: (name, update) => {
            const definition = registry.get(name);
            update(definition);
            registry.set(name, definition);
          },
        });
        return { dispose: async () => disposed++ };
      },
    },
  });
  assert.notEqual(registry.get("opencode_worktree_create").execute, originalExecute);
  await dispose();
  assert.equal(disposed, 1);
});

test("replayed tool transforms wrap a fresh native registry", async () => {
  const originalExecute = async () => ({ content: "ok" });
  let replay;
  await plugin.default.setup({
    tool: {
      transform: async (transform) => {
        replay = transform;
        return { dispose: async () => {} };
      },
    },
  });
  const registry = new Map([
    ["opencode_worktree_create", { execute: originalExecute }],
  ]);
  replay({
    get: (name) => registry.get(name),
    update: (name, update) => {
      const definition = registry.get(name);
      update(definition);
      registry.set(name, definition);
    },
  });
  assert.notEqual(registry.get("opencode_worktree_create").execute, originalExecute);
});

test("extracts a structured native worktree directory", () => {
  assert.equal(
    plugin.observedWorktreeDirectory({ metadata: { directory: "/repo/worktrees/topic" } }),
    "/repo/worktrees/topic",
  );
  assert.equal(plugin.observedWorktreeDirectory({ output: "created" }), null);
});

test("wraps the native worktree executor and reports its exact session context", async () => {
  const calls = [];
  const registry = new Map([[
    "opencode_worktree_create",
    { execute: async (input) => ({ metadata: { directory: input.directory } }), description: "native" },
  ]]);
  const observer = plugin.createTicketWorktreeObserver({
    executable: "/app/project-mgr",
    appDataDirectory: "/app/data",
    spawnProcess: async (...args) => calls.push(args),
  });
  await observer({ tool: { transform: (transform) => transform({
    get: (name) => registry.get(name),
    update: (name, update) => {
      const definition = registry.get(name);
      update(definition);
      registry.set(name, definition);
    },
  }) } });
  const result = await registry.get("opencode_worktree_create").execute(
    { directory: "/repo/worktrees/topic" },
    { sessionID: "ses_ticket" },
  );
  assert.deepEqual(result, { metadata: { directory: "/repo/worktrees/topic" } });
  assert.deepEqual(calls, [[
    "/app/project-mgr",
    ["ticket-worktree-observed", "/app/data", "ses_ticket", "/repo/worktrees/topic"],
  ]]);
});

test("does not report missing result paths or missing session identity", async () => {
  const calls = [];
  const registry = new Map([[
    "opencode_worktree_create",
    { execute: async () => ({ metadata: { directory: "/repo/worktrees/topic" } }) },
  ]]);
  const observer = plugin.createTicketWorktreeObserver({ spawnProcess: async (...args) => calls.push(args) });
  await observer({ tool: { transform: (transform) => transform({
    get: (name) => registry.get(name),
    update: (name, update) => {
      const definition = registry.get(name);
      update(definition);
      registry.set(name, definition);
    },
  }) } });
  await registry.get("opencode_worktree_create").execute({}, {});
  assert.deepEqual(calls, []);
});
