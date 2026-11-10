// project-mgr managed plugin. Keep this source in the repository.
import { Plugin } from "@opencode/plugin";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";

const CONFIG_FILENAME = "project-mgr-ticket-worktree.json";

export function runtimeConfigPath({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  const pathJoin = platform === "win32" ? win32.join : join;
  const configRoot =
    platform === "win32"
      ? env.APPDATA || pathJoin(home, "AppData", "Roaming")
      : platform === "darwin"
        ? pathJoin(home, "Library", "Application Support")
        : env.XDG_CONFIG_HOME || pathJoin(home, ".config");
  return pathJoin(configRoot, "opencode", "plugins", CONFIG_FILENAME);
}

function readRuntimeConfig() {
  const config = JSON.parse(readFileSync(runtimeConfigPath(), "utf8"));
  if (
    config.schemaVersion !== 1 ||
    config.managedBy !== "opencode-project-manager-ticket-plugin" ||
    typeof config.executable !== "string" ||
    typeof config.appDataDirectory !== "string"
  ) {
    throw new Error("Invalid project-mgr ticket plugin configuration");
  }
  return config;
}

export function observedWorktreeDirectory(result) {
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (depth > 5 || value == null) return null;
    if (typeof value === "string") {
      const candidate = value.trim();
      return candidate.startsWith("/") ? candidate : null;
    }
    if (typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    for (const key of ["directory", "worktree", "path"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.startsWith("/"))
        return candidate;
    }
    for (const key of ["output", "metadata", "content", "result"]) {
      const candidate = visit(value[key], depth + 1);
      if (candidate) return candidate;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const candidate = visit(item, depth + 1);
        if (candidate) return candidate;
      }
    }
    return null;
  };
  return visit(result);
}

export function createTicketWorktreeObserver({
  executable,
  appDataDirectory,
  spawnProcess = runBridge,
} = {}) {
  return async ({ tool }) => {
    const registration = await tool.transform((registry) => {
      for (const name of ["opencode_worktree_create"]) {
        const registered = registry.get(name);
        if (!registered) continue;
        const execute = registered.execute;
        const wrappedExecute = async (input, context) => {
          const result = await execute(input, context);
          const directory = observedWorktreeDirectory(result);
          const sessionID = context?.sessionID;
          if (directory && typeof sessionID === "string") {
            try {
              await spawnProcess(executable, [
                "ticket-worktree-observed",
                appDataDirectory,
                sessionID,
                directory,
              ]);
            } catch {
              // Native creation already succeeded; don't present a failed
              // observation receipt as a rollback of that external effect.
              console.error(
                "project-mgr could not record an observed worktree",
              );
            }
          }
          return result;
        };
        registry.update(name, (toolDefinition) => {
          toolDefinition.execute = wrappedExecute;
        });
      }
    });
    return () => registration.dispose();
  };
}

function runBridge(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const limit = (current, chunk) =>
      (current + chunk.toString()).slice(0, 4096);
    child.stdout.on("data", (chunk) => {
      stdout = limit(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = limit(stderr, chunk);
    });
    const timeout = setTimeout(() => child.kill(), 5000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `Ticket worktree bridge exited (${code ?? "signal"}): ${stderr.slice(0, 256)}`,
          ),
        );
    });
  });
}

export default Plugin.define({
  id: "project-mgr-ticket-worktree",
  async setup(ctx) {
    return createTicketWorktreeObserver(readRuntimeConfig())(ctx);
  },
});
