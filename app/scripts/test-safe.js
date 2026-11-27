// Run every test file in its own memory-limited scope, including focused runs.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const appFiles = readdirSync(new URL("../test/", import.meta.url))
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => `test/${name}`)
  .sort();
const uiFiles = readdirSync(
  new URL("../packages/ui-lib/test/", import.meta.url),
)
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => `packages/ui-lib/test/${name}`)
  .sort();
const browserFiles = appFiles.filter((name) =>
  name.endsWith(".browser.test.js"),
);
const nativeFiles = [
  "test/model-loader-integration.test.js",
  "test/rust-wire-contract.integration.test.js",
];
const defaultFiles = [
  ...appFiles.filter(
    (name) => !browserFiles.includes(name) && !nativeFiles.includes(name),
  ),
  ...uiFiles,
];

const args = process.argv.slice(2);
const mode = args.shift();
if (!["default", "browser", "all"].includes(mode)) {
  console.error(
    "Usage: npm test --prefix app -- [test/file.test.js ...] [--name=regex] [--ui-lib]",
  );
  process.exit(2);
}
let namePattern;
let uiOnly = false;
let plugin;
const requested = [];
for (const arg of args) {
  if (
    arg.startsWith("--name=") &&
    arg.length > 7 &&
    namePattern === undefined
  ) {
    namePattern = arg.slice(7);
    try {
      new RegExp(namePattern);
    } catch {
      console.error("Invalid --name regular expression");
      process.exit(2);
    }
  } else if (arg === "--ui-lib" && !uiOnly) {
    uiOnly = true;
  } else if (
    arg.startsWith("--plugin=") &&
    ["agent-loop", "agent-loop-model-gate"].includes(arg.slice(9)) &&
    !plugin
  ) {
    plugin = arg.slice(9);
  } else if (!arg.startsWith("-") && arg) {
    requested.push(arg);
  } else {
    console.error(`Unknown or invalid test argument: ${arg}`);
    process.exit(2);
  }
}
if ((uiOnly || plugin) && (mode !== "default" || (uiOnly && plugin))) {
  console.error(
    "--ui-lib and --plugin require the default suite and cannot be combined",
  );
  process.exit(2);
}
const pluginFiles = plugin
  ? readdirSync(resolve(repoRoot, "opencode/plugins", plugin))
      .filter((name) => name.endsWith(".test.js"))
      .map((name) => `../opencode/plugins/${plugin}/${name}`)
      .sort()
  : [];
const allowed = plugin
  ? pluginFiles
  : mode === "browser"
    ? browserFiles
    : mode === "all"
      ? [...defaultFiles, ...nativeFiles, ...browserFiles]
      : uiOnly
        ? uiFiles
        : defaultFiles;
const files = requested.length
  ? requested.map((file) => {
      // Accept repo-root paths, app-relative paths, and ui-lib workspace paths.
      const normalized = file
        .replaceAll("\\", "/")
        .replace(/^\.\//, "")
        .replace(/^app\//, "");
      if (allowed.includes(normalized)) return normalized;
      if (plugin) {
        const pluginPath = `../opencode/plugins/${plugin}/${normalized.replace(/^\.\//, "")}`;
        if (allowed.includes(pluginPath)) return pluginPath;
        const repoPath = `../${normalized}`;
        if (allowed.includes(repoPath)) return repoPath;
      }
      const workspacePath = `packages/ui-lib/${normalized}`;
      if (uiOnly && allowed.includes(workspacePath)) return workspacePath;
      if (isAbsolute(file)) {
        const rel = relative(appRoot, resolve(file)).replaceAll("\\", "/");
        if (allowed.includes(rel)) return rel;
      }
      console.error(
        `Unknown test file or file outside the selected cohort: ${file}`,
      );
      process.exit(2);
    })
  : allowed;
if (!files.length) {
  console.error("No test files selected");
  process.exit(2);
}
if (process.platform !== "linux") {
  console.error(
    "Safe test execution requires Linux systemd user scopes; no tests were started.",
  );
  process.exit(1);
}

let active;
let interrupted = false;
function stop(signal) {
  if (!active || active.exitCode !== null || active.signalCode !== null) return;
  try {
    process.kill(-active.pid, signal);
  } catch {
    active.kill(signal);
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    stop(signal);
  });
}
async function run(file) {
  console.log(`\nRunning ${file} (1 GiB limit, no swap)`);
  const nodeArgs = ["--test", "--test-concurrency=1"];
  if (namePattern !== undefined)
    nodeArgs.push(`--test-name-pattern=${namePattern}`);
  nodeArgs.push(file);
  const child = spawn(
    "systemd-run",
    [
      "--user",
      "--scope",
      "--quiet",
      "-p",
      "MemoryMax=1G",
      "-p",
      "MemorySwapMax=0",
      "--",
      process.execPath,
      ...nodeArgs,
    ],
    {
      cwd: appRoot,
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=512"]
          .filter(Boolean)
          .join(" "),
      },
      stdio: "inherit",
      detached: true,
    },
  );
  active = child;
  let timedOut = false;
  let forceStop;
  const timeout = setTimeout(() => {
    timedOut = true;
    console.error(`${file} exceeded 15 minutes; stopping it`);
    stop("SIGTERM");
    forceStop = setTimeout(() => stop("SIGKILL"), 5000);
    forceStop.unref();
  }, 15 * 60_000);
  try {
    const [code, signal] = await once(child, "close");
    if (signal) console.error(`${file} stopped by ${signal}`);
    if (code !== 0 || signal || timedOut)
      console.error(`FAILED: ${file} (exit ${code ?? "none"})`);
    return code === 0 && !signal && !timedOut;
  } catch (error) {
    console.error(
      `Could not start memory-limited test ${file}: ${error.message}. No uncapped fallback.`,
    );
    interrupted = true;
    return false;
  } finally {
    clearTimeout(timeout);
    clearTimeout(forceStop);
    active = undefined;
  }
}

let failed = false;
for (const file of [...new Set(files)]) {
  if (interrupted) break;
  if (!(await run(file))) {
    failed = true;
    console.error("Stopping after failure; remaining test files were not run.");
    break;
  }
}
process.exitCode = failed || interrupted ? 1 : 0;
