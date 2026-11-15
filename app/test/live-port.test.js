import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import {
  availableLivePort,
  captureChildOutput,
  createRunLog,
  formatRunLogHeader,
  livePortFor,
  liveExitCode,
  MAX_LIVE_LOG_BYTES,
  openRunLog,
  pruneExpiredLiveLogs,
  resolveAppLogDirectory,
  runLogFilename,
  tauriCommand,
  tauriDevConfig,
  tauriDevEnvironment,
} from "../scripts/live.js";

function temporaryDirectory() {
  return mkdtempSync(path.join(tmpdir(), "project-mgr-live-test-"));
}

function collectingWritable(chunks) {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
}

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

test("live environment defaults Rust backtraces and preserves explicit overrides", () => {
  assert.equal(tauriDevEnvironment({}, 37891, "run-id").RUST_BACKTRACE, "full");
  assert.equal(
    tauriDevEnvironment({ RUST_BACKTRACE: "0" }, 37891, "run-id")
      .RUST_BACKTRACE,
    "0",
  );
  assert.equal(
    tauriDevEnvironment({}, 37891, "run-id").PROJECT_MGR_LIVE_RUN_ID,
    "run-id",
  );
});

test("live exit status preserves child code and reports signal termination", () => {
  assert.equal(liveExitCode(17, null), 17);
  assert.equal(liveExitCode(0, null), 0);
  assert.equal(liveExitCode(null, "SIGABRT"), 1);
});

test("Vite uses the port passed by the live launcher", async () => {
  const previous = process.env.PROJECT_MGR_DEV_PORT;
  process.env.PROJECT_MGR_DEV_PORT = "37891";
  try {
    const { default: config } =
      await import("../vite.config.js?live-port-test");
    assert.equal(config.server.port, 37891);
  } finally {
    if (previous === undefined) delete process.env.PROJECT_MGR_DEV_PORT;
    else process.env.PROJECT_MGR_DEV_PORT = previous;
  }
});

test("Tauri app log directory follows documented platform defaults", () => {
  assert.equal(
    resolveAppLogDirectory({
      platform: "linux",
      env: { HOME: "/home/test", XDG_DATA_HOME: "/data/test" },
    }),
    "/data/test/dev.opencode.projectmgr/logs/live-runs",
  );
  assert.equal(
    resolveAppLogDirectory({
      platform: "darwin",
      env: { HOME: "/Users/test" },
    }),
    "/Users/test/Library/Logs/dev.opencode.projectmgr/live-runs",
  );
  assert.equal(
    resolveAppLogDirectory({
      platform: "win32",
      env: {
        USERPROFILE: "C:\\Users\\test",
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      },
    }),
    "C:\\Users\\test\\AppData\\Local\\dev.opencode.projectmgr\\logs\\live-runs",
  );
});

test("Tauri app log directory honors root, per-log, and variable overrides", () => {
  assert.equal(
    resolveAppLogDirectory({
      platform: "linux",
      env: { HOME: "/home/test" },
      appConfig: { appDirectoriesOverride: "/portable/app-data" },
      executableDirectory: "/repo/target/debug",
    }),
    "/portable/app-data/logs/live-runs",
  );
  assert.equal(
    resolveAppLogDirectory({
      platform: "linux",
      env: { HOME: "/home/test", XDG_DATA_HOME: "/data/test" },
      appConfig: { appDirectoriesOverride: { log: "$DATA/custom/logs" } },
    }),
    "/data/test/custom/logs/live-runs",
  );
  assert.equal(
    resolveAppLogDirectory({
      platform: "linux",
      env: { HOME: "/home/test" },
      appConfig: { appDirectoriesOverride: "./app-data" },
      executableDirectory: "/repo/target/debug",
    }),
    "/repo/target/debug/app-data/logs/live-runs",
  );
});

test("run log names are unique and expired logs are pruned only by feature pattern", () => {
  const directory = temporaryDirectory();
  try {
    const date = new Date("2026-11-14T15:30:12.000Z");
    const first = runLogFilename(
      date,
      123,
      "a1234567-b123-c123-d123-a123456789ab",
    );
    const second = runLogFilename(
      date,
      123,
      "b1234567-b123-c123-d123-a123456789ab",
    );
    assert.notEqual(first, second);
    writeFileSync(path.join(directory, first), "old run");
    writeFileSync(path.join(directory, "unrelated.log"), "keep");
    const old = new Date("2026-11-01T00:00:00Z");
    utimesSync(path.join(directory, first), old, old);

    assert.equal(pruneExpiredLiveLogs(directory, date.getTime()), 1);
    assert.deepEqual(readdirSync(directory), ["unrelated.log"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("configured live log limit is 25 MiB", () => {
  assert.equal(MAX_LIVE_LOG_BYTES, 25 * 1024 * 1024);
});

test("run log is created exclusively with required metadata", () => {
  const directory = temporaryDirectory();
  const date = new Date("2026-11-14T15:30:12.000Z");
  const runId = "a1234567-b123-c123-d123-a123456789ab";
  const header = formatRunLogHeader({
    date,
    worktree: "/repo",
    revision: "abc123",
    pid: 123,
    runId,
  });
  try {
    const result = createRunLog({
      directory,
      date,
      pid: 123,
      runId,
      header,
    });
    assert.equal(
      path.basename(result.filePath),
      runLogFilename(date, 123, runId),
    );
    assert.match(readFileSync(result.filePath, "utf8"), /worktree=\/repo/);
    assert.match(readFileSync(result.filePath, "utf8"), /revision=abc123/);
    assert.match(readFileSync(result.filePath, "utf8"), /launcher_pid=123/);
    assert.match(readFileSync(result.filePath, "utf8"), new RegExp(runId));
    assert.match(
      readFileSync(result.filePath, "utf8"),
      /started_utc=2026-11-14T15:30:12\.000Z/,
    );
    assert.throws(
      () =>
        createRunLog({
          directory,
          date,
          pid: 123,
          runId,
          header: "overwrite",
        }),
      /EEXIST/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("log directory creation failure prevents the live child from launching", () => {
  const directory = temporaryDirectory();
  const dataDirectory = path.join(directory, "data");
  const appLogParent = path.join(dataDirectory, "dev.opencode.projectmgr");
  mkdirSync(appLogParent, { recursive: true });
  writeFileSync(path.join(appLogParent, "logs"), "not a directory");

  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/live.js", import.meta.url))],
      {
        cwd: process.cwd(),
        env: { ...process.env, XDG_DATA_HOME: dataDirectory },
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /ENOTDIR|EEXIST/);
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /Live output log:|VITE v/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("child output is logged, forwarded, and truncated at the configured cap", async () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "capture.log");
  const initial = "header\n";
  writeFileSync(filePath, initial);
  const logStream = await openRunLog(filePath);
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const stdoutChunks = [];
  const stderrChunks = [];
  const finishCapture = captureChildOutput({
    child,
    logStream,
    stdout: collectingWritable(stdoutChunks),
    stderr: collectingWritable(stderrChunks),
    initialBytes: Buffer.byteLength(initial),
    maxBytes: 100,
  });
  child.stdout.write("out\n");
  child.stderr.write("err\n");
  child.stdout.write("x".repeat(200));
  child.stdout.end();
  child.stderr.end();
  await Promise.all([onceEnd(child.stdout), onceEnd(child.stderr)]);
  const result = await finishCapture();
  const saved = readFileSync(filePath, "utf8");
  try {
    assert.equal(
      Buffer.concat(stdoutChunks).toString(),
      `out\n${"x".repeat(200)}`,
    );
    assert.equal(Buffer.concat(stderrChunks).toString(), "err\n");
    assert.ok(saved.includes("out\n"));
    assert.ok(saved.includes("err\n"));
    assert.ok(saved.includes("[run log truncated at 25 MiB]"));
    assert.ok(Buffer.byteLength(saved) <= 100);
    assert.equal(result.truncated, true);
    assert.equal(result.logFailed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a post-launch log write failure is reported while terminal output continues", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const terminalChunks = [];
  const reportedErrors = [];
  const logStream = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("disk full"));
    },
  });
  const finishCapture = captureChildOutput({
    child,
    logStream,
    stdout: collectingWritable(terminalChunks),
    stderr: collectingWritable([]),
    onLogError: (error) => reportedErrors.push(error.message),
  });
  child.stdout.write("still visible\n");
  await new Promise((resolve) => logStream.once("error", resolve));
  child.stdout.end();
  child.stderr.end();
  await Promise.all([onceEnd(child.stdout), onceEnd(child.stderr)]);
  const result = await finishCapture();

  assert.equal(Buffer.concat(terminalChunks).toString(), "still visible\n");
  assert.deepEqual(reportedErrors, ["disk full"]);
  assert.equal(result.logFailed, true);
});

test("captured native PID marker leads to the run log lookup", async () => {
  const directory = temporaryDirectory();
  const filePath = path.join(directory, "live-test.log");
  writeFileSync(filePath, "worktree=/worktree-b\nrun_id=test-run\n");
  const logStream = await openRunLog(filePath);
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const finishCapture = captureChildOutput({
    child,
    logStream,
    stdout: collectingWritable([]),
    stderr: collectingWritable([]),
    initialBytes: Buffer.byteLength("worktree=/worktree-b\nrun_id=test-run\n"),
  });
  child.stderr.write(
    "PROJECT_MGR_LIVE_PROCESS pid=1782997 run_id=a1234567-b123-c123-d123-a123456789ab\n",
  );
  child.stdout.end();
  child.stderr.end();
  await Promise.all([onceEnd(child.stdout), onceEnd(child.stderr)]);
  await finishCapture();
  const matchingLogs = readdirSync(directory).filter((name) =>
    readFileSync(path.join(directory, name), "utf8").includes(
      "PROJECT_MGR_LIVE_PROCESS pid=1782997 ",
    ),
  );
  try {
    assert.deepEqual(matchingLogs, ["live-test.log"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function onceEnd(stream) {
  return new Promise((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
  });
}
