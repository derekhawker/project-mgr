import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import {
  closeSync,
  createWriteStream,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const FIRST_PORT = 30000;
const PORT_COUNT = 20000;
const APP_ID = "dev.opencode.projectmgr";
const LIVE_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_LIVE_LOG_BYTES = 25 * 1024 * 1024;
const TRUNCATION_MARKER = "\n[run log truncated at 25 MiB]\n";
const LIVE_LOG_PATTERN = /^live-\d{8}T\d{6}Z-\d+-[0-9a-f-]+\.log$/;

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

export function tauriDevEnvironment(env, port, runId) {
  return {
    ...env,
    PROJECT_MGR_DEV_PORT: String(port),
    PROJECT_MGR_LIVE_RUN_ID: runId,
    RUST_BACKTRACE: env.RUST_BACKTRACE ?? "full",
  };
}

export function liveExitCode(code, signal) {
  return signal ? 1 : (code ?? 1);
}

function defaultBaseDirectories(platform, env) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const home = env.HOME || env.USERPROFILE || homedir();
  if (platform === "darwin") {
    return {
      home,
      data: paths.join(home, "Library", "Application Support"),
      localData: paths.join(home, "Library", "Application Support"),
      localdata: paths.join(home, "Library", "Application Support"),
      config: paths.join(home, "Library", "Application Support"),
      cache: paths.join(home, "Library", "Caches"),
      temp: env.TMPDIR || "/tmp",
    };
  }
  if (platform === "win32") {
    const localData = env.LOCALAPPDATA || paths.join(home, "AppData", "Local");
    return {
      home,
      data: env.APPDATA || paths.join(home, "AppData", "Roaming"),
      localData,
      localdata: localData,
      config: env.APPDATA || paths.join(home, "AppData", "Roaming"),
      cache: paths.join(localData, "Temp"),
      temp: env.TEMP || env.TMP || paths.join(localData, "Temp"),
    };
  }
  const data = env.XDG_DATA_HOME || paths.join(home, ".local", "share");
  return {
    home,
    data,
    localData: data,
    localdata: data,
    config: env.XDG_CONFIG_HOME || paths.join(home, ".config"),
    cache: env.XDG_CACHE_HOME || paths.join(home, ".cache"),
    temp: env.TMPDIR || "/tmp",
  };
}

function resolveOverridePath(value, { platform, env, executableDirectory }) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const bases = defaultBaseDirectories(platform, env);
  const match = value.match(/^\$([A-Z]+)(?:[\\/]|$)(.*)$/);
  if (match) {
    const variable = match[1];
    const base = bases[variable.toLowerCase()];
    if (!base) throw new Error(`Unsupported Tauri path variable: $${variable}`);
    return paths.resolve(base, match[2] || "");
  }
  if (paths.isAbsolute(value)) return paths.normalize(value);
  return paths.resolve(executableDirectory, value);
}

export function resolveAppLogDirectory({
  platform = process.platform,
  env = process.env,
  appConfig,
  identifier = APP_ID,
  executableDirectory,
}) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const bases = defaultBaseDirectories(platform, env);
  const override = appConfig?.appDirectoriesOverride;
  let logDirectory;
  if (typeof override === "string") {
    logDirectory = paths.join(
      resolveOverridePath(override, { platform, env, executableDirectory }),
      "logs",
    );
  } else if (override && typeof override === "object" && override.log) {
    logDirectory = resolveOverridePath(override.log, {
      platform,
      env,
      executableDirectory,
    });
  } else if (platform === "darwin") {
    logDirectory = paths.join(bases.home, "Library", "Logs", identifier);
  } else {
    logDirectory = paths.join(bases.localData, identifier, "logs");
  }
  return paths.join(logDirectory, "live-runs");
}

export function pruneExpiredLiveLogs(directory, now = Date.now()) {
  let removed = 0;
  for (const name of readdirSync(directory)) {
    if (!LIVE_LOG_PATTERN.test(name)) continue;
    const file = path.join(directory, name);
    try {
      if (now - statSync(file).mtimeMs > LIVE_LOG_RETENTION_MS) {
        unlinkSync(file);
        removed++;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return removed;
}

function compactUtc(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export function runLogFilename(date, pid, runId) {
  return `live-${compactUtc(date)}-${pid}-${runId}.log`;
}

export function formatRunLogHeader({ date, worktree, revision, pid, runId }) {
  return [
    "OpenCode Project Manager live run",
    `started_utc=${date.toISOString()}`,
    `worktree=${worktree}`,
    `revision=${revision}`,
    `launcher_pid=${pid}`,
    `run_id=${runId}`,
    "--- output ---",
    "",
  ].join("\n");
}

export function createRunLog({ directory, date, pid, runId, header }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, runLogFilename(date, pid, runId));
  const fd = openSync(filePath, "wx", 0o600);
  try {
    writeSync(fd, header);
    closeSync(fd);
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  return { filePath, bytesWritten: Buffer.byteLength(header) };
}

export async function openRunLog(filePath) {
  const stream = createWriteStream(filePath, { flags: "a" });
  await Promise.race([
    once(stream, "open"),
    once(stream, "error").then(([error]) => Promise.reject(error)),
  ]);
  return stream;
}

export function captureChildOutput({
  child,
  logStream,
  stdout = process.stdout,
  stderr = process.stderr,
  maxBytes = MAX_LIVE_LOG_BYTES,
  initialBytes = 0,
  onLogError = (error) =>
    console.error(
      `Live output capture failed; log is incomplete: ${error.message}`,
    ),
}) {
  let bytesWritten = initialBytes;
  let captureEnabled = true;
  let truncationWritten = false;
  let logFailed = false;
  const streams = [child.stdout, child.stderr].filter(Boolean);
  const markLogFailure = (error) => {
    if (logFailed) return;
    logFailed = true;
    captureEnabled = false;
    onLogError(error);
    for (const stream of streams) stream.resume();
  };
  logStream.on("error", markLogFailure);

  const append = (chunk) => {
    if (!captureEnabled) return;
    const marker = Buffer.from(TRUNCATION_MARKER);
    const payloadLimit = Math.max(0, maxBytes - marker.length);
    const remaining = Math.max(0, payloadLimit - bytesWritten);
    if (chunk.length <= remaining) {
      bytesWritten += chunk.length;
      if (!logStream.write(chunk)) {
        for (const stream of streams) stream.pause();
      }
      return;
    }

    if (remaining > 0) {
      bytesWritten += remaining;
      if (!logStream.write(chunk.subarray(0, remaining))) {
        for (const stream of streams) stream.pause();
      }
    }
    if (!truncationWritten && bytesWritten + marker.length <= maxBytes) {
      truncationWritten = true;
      bytesWritten += marker.length;
      if (!logStream.write(marker)) {
        for (const stream of streams) stream.pause();
      }
    }
    captureEnabled = false;
  };

  logStream.on("drain", () => {
    if (!logFailed) {
      for (const stream of streams) stream.resume();
    }
  });
  child.stdout?.on("data", (chunk) => {
    stdout.write(chunk);
    append(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr.write(chunk);
    append(chunk);
  });

  return async () => {
    if (logStream.destroyed)
      return { bytesWritten, truncated: truncationWritten, logFailed };
    logStream.end();
    await new Promise((resolve) => {
      logStream.once("finish", resolve);
      logStream.once("error", resolve);
    });
    return { bytesWritten, truncated: truncationWritten, logFailed };
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
  const appDirectory = realpathSync(process.cwd());
  const worktreeRoot = realpathSync(
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: appDirectory,
      encoding: "utf8",
    }).trim(),
  );
  const date = new Date();
  const runId = randomUUID();
  const configPath = fileURLToPath(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
  );
  const tauriConfig = JSON.parse(readFileSync(configPath, "utf8"));
  const targetDirectory = process.env.CARGO_TARGET_DIR
    ? path.resolve(worktreeRoot, process.env.CARGO_TARGET_DIR, "debug")
    : path.join(worktreeRoot, "app", "src-tauri", "target", "debug");
  const logDirectory = resolveAppLogDirectory({
    appConfig: tauriConfig.app,
    identifier: tauriConfig.identifier,
    executableDirectory: targetDirectory,
  });
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  pruneExpiredLiveLogs(logDirectory);
  const revision = (() => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: worktreeRoot,
        encoding: "utf8",
      }).trim();
    } catch {
      return "unavailable";
    }
  })();
  const port = await availableLivePort(worktreeRoot);
  const { command, args } = tauriCommand(port);
  const header = formatRunLogHeader({
    date,
    worktree: worktreeRoot,
    revision,
    pid: process.pid,
    runId,
  });
  const { filePath, bytesWritten } = createRunLog({
    directory: logDirectory,
    date,
    pid: process.pid,
    runId,
    header,
  });
  console.log(`Live output log: ${filePath}`);
  const logStream = await openRunLog(filePath);

  let tauri;
  try {
    tauri = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: tauriDevEnvironment(process.env, port, runId),
    });
  } catch (error) {
    console.error(`Could not start Tauri: ${error.message}`);
    logStream.end(`launcher_error=${error.message}\n`);
    await new Promise((resolve) => {
      logStream.once("finish", resolve);
      logStream.once("error", resolve);
    });
    process.exitCode = 1;
    return;
  }
  const cliPidLine = `tauri_cli_pid=${tauri.pid ?? "unavailable"}\n`;
  logStream.write(cliPidLine);
  const finishCapture = captureChildOutput({
    child: tauri,
    logStream,
    initialBytes: bytesWritten + Buffer.byteLength(cliPidLine),
  });
  tauri.once("error", (error) => {
    console.error(`Could not start Tauri: ${error.message}`);
    logStream.write(`launcher_error=${error.message}\n`);
    process.exitCode = 1;
  });
  tauri.once("close", (code, signal) => {
    void finishCapture().then(() => {
      process.exitCode = liveExitCode(code, signal);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
