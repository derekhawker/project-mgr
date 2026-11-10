import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const FIRST_PORT = 30000;
const PORT_COUNT = 20000;

export function livePortFor(worktreePath) {
  const digest = createHash("sha256").update(worktreePath).digest();
  return FIRST_PORT + (digest.readUInt32BE(0) % PORT_COUNT);
}

export function tauriDevConfig(port) {
  return { build: { devUrl: `http://127.0.0.1:${port}` } };
}

export function tauriCommand(port) {
  const cliPath = fileURLToPath(
    new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
  );
  return {
    command: process.execPath,
    args: [cliPath, "dev", "--config", JSON.stringify(tauriDevConfig(port))],
  };
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export async function availableLivePort(worktreePath) {
  const start = livePortFor(worktreePath);
  for (let offset = 0; offset < PORT_COUNT; offset++) {
    const port = FIRST_PORT + ((start - FIRST_PORT + offset) % PORT_COUNT);
    if (await portIsAvailable(port)) return port;
  }
  throw new Error("No available local development port in the live port range");
}

async function main() {
  const port = await availableLivePort(realpathSync(process.cwd()));
  const { command, args } = tauriCommand(port);
  const tauri = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, PROJECT_MGR_DEV_PORT: String(port) },
  });

  tauri.once("error", (error) => {
    console.error(`Could not start Tauri: ${error.message}`);
    process.exitCode = 1;
  });
  tauri.once("exit", (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
