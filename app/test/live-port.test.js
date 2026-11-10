import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  availableLivePort,
  livePortFor,
  tauriCommand,
  tauriDevConfig,
} from "../scripts/live.js";

test("live development assigns distinct stable ports to separate worktrees", () => {
  const first = livePortFor("/worktrees/feature-one");
  const second = livePortFor("/worktrees/feature-two");

  assert.notEqual(first, second);
  assert.equal(first, livePortFor("/worktrees/feature-one"));
  assert.ok(first >= 30000 && first <= 49999);
  assert.ok(second >= 30000 && second <= 49999);
});

test("live launcher avoids an occupied worktree port", async () => {
  const worktreePath = "/worktrees/occupied-port";
  const occupiedPort = livePortFor(worktreePath);
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(occupiedPort, "127.0.0.1", resolve);
  });
  try {
    const selectedPort = await availableLivePort(worktreePath);
    assert.notEqual(selectedPort, occupiedPort);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("live Tauri config points to the worktree's allocated Vite port", () => {
  assert.deepEqual(tauriDevConfig(37891), {
    build: { devUrl: "http://127.0.0.1:37891" },
  });
});

test("live starts the Tauri CLI through the current Node executable", () => {
  const command = tauriCommand(37891);
  assert.equal(command.command, process.execPath);
  assert.match(command.args[0], /node_modules\/\@tauri-apps\/cli\/tauri\.js$/);
  assert.deepEqual(command.args.slice(1), [
    "dev",
    "--config",
    JSON.stringify({ build: { devUrl: "http://127.0.0.1:37891" } }),
  ]);
});

test("Vite uses the port passed by the live launcher", async () => {
  const previous = process.env.PROJECT_MGR_DEV_PORT;
  process.env.PROJECT_MGR_DEV_PORT = "37891";
  try {
    const { default: config } = await import("../vite.config.js?live-port-test");
    assert.equal(config.server.port, 37891);
  } finally {
    if (previous === undefined) delete process.env.PROJECT_MGR_DEV_PORT;
    else process.env.PROJECT_MGR_DEV_PORT = previous;
  }
});
