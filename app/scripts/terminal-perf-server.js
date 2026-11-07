// Opt-in local test bridge. It never attaches to application-owned terminals.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { accessSync, constants } from "node:fs";
import { WebSocketServer } from "ws";

const token = randomBytes(32).toString("hex");
const expectedOrigin = "http://127.0.0.1:1420";
const binary = fileURLToPath(
  new URL("../src-tauri/target/debug/terminal-perf-harness", import.meta.url),
);
try {
  accessSync(binary, constants.X_OK);
} catch {
  console.error("Build the PTY harness first; see app/README.md.");
  process.exit(1);
}
const server = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536 });
let active = false;
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const candidate = Buffer.from(url.searchParams.get("token") || "");
  const expected = Buffer.from(token);
  if (
    active ||
    req.headers.origin !== expectedOrigin ||
    url.pathname !== "/terminal" ||
    candidate.length !== expected.length ||
    !timingSafeEqual(candidate, expected)
  ) {
    socket.destroy();
    return;
  }
  active = true;
  sockets.handleUpgrade(req, socket, head, (ws) =>
    sockets.emit("connection", ws),
  );
});
sockets.on("connection", (ws) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "inherit"] });
  child.stdout.on("data", (data) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.close(1011, "PTY output backlog exceeded");
      return;
    }
    ws.send(data);
  });
  child.stdin.on("error", () => {
    if (ws.readyState === ws.OPEN) ws.close(1011, "PTY input closed");
  });
  child.on("error", () => {
    active = false;
    ws.close(1011, "PTY harness failed to start");
  });
  child.on("exit", () => {
    active = false;
    if (ws.readyState === ws.OPEN) ws.close();
  });
  ws.on("message", (data, binary) => {
    if (!binary || !child.stdin.writable) return;
    if (child.stdin.writableLength > 1024 * 1024) {
      ws.close(1011, "PTY input backlog exceeded");
      return;
    }
    child.stdin.write(data);
  });
  ws.on("close", () => {
    child.stdin.end();
  });
  ws.on("error", () => ws.terminate());
});
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  console.log(`Open http://127.0.0.1:1420/terminal-perf.html#${port}:${token}`);
  console.log(
    "Development shell starts in the system temporary directory; it is not sandboxed.",
  );
});
