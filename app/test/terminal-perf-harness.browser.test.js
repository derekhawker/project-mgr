import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";

test(
  "opt-in PTY bridge rejects untrusted origins and carries interactive shell input",
  { timeout: 15000 },
  async () => {
    const server = spawn(
      process.execPath,
      ["scripts/terminal-perf-server.js"],
      { cwd: new URL("..", import.meta.url) },
    );
    try {
      const [chunk] = await once(server.stdout, "data");
      const match = String(chunk).match(
        /terminal-perf\.html#(\d+):([a-f0-9]{64})/,
      );
      assert.ok(match, "server supplies a per-run endpoint and token");
      const address = `ws://127.0.0.1:${match[1]}/terminal?token=${match[2]}`;
      const badToken = new WebSocket(
        `ws://127.0.0.1:${match[1]}/terminal?token=${"0".repeat(64)}`,
        { origin: "http://127.0.0.1:1420" },
      );
      assert.ok((await once(badToken, "error"))[0]);
      const rejected = new WebSocket(address, {
        origin: "http://evil.example",
      });
      const [error] = await once(rejected, "error");
      assert.ok(error);
      const socket = new WebSocket(address, {
        origin: "http://127.0.0.1:1420",
      });
      try {
        await once(socket, "open");
        const output = [];
        const done = new Promise((resolve) =>
          socket.on("message", (data) => {
            output.push(data.toString());
            if (output.join("").includes("PERF_BRIDGE_OK")) resolve();
          }),
        );
        socket.send(Buffer.from("printf 'PERF_BRIDGE_'\"OK\"'\\n'\n"));
        await done;
        assert.match(output.join(""), /PERF_BRIDGE_OK/);
      } finally {
        socket.close();
      }
    } finally {
      server.kill();
      await once(server, "exit");
    }
  },
);
