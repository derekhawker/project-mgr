import { readdirSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const appRoot = new URL("../", import.meta.url);
const appTestDir = new URL("../test/", import.meta.url);
const uiTestDir = new URL("../packages/ui-lib/test/", import.meta.url);
const appFiles = readdirSync(appTestDir).filter((name) =>
  name.endsWith(".test.js"),
);
const uiFiles = readdirSync(uiTestDir).filter((name) =>
  name.endsWith(".test.js"),
);
const nativeFiles = new Set([
  "test/model-loader-integration.test.js",
  "test/rust-wire-contract.integration.test.js",
]);
const defaultFiles = [
  ...appFiles
    .filter(
      (name) =>
        !name.endsWith(".browser.test.js") && !nativeFiles.has(`test/${name}`),
    )
    .map((name) => `test/${name}`),
  ...uiFiles.map((name) => `packages/ui-lib/test/${name}`),
];

const args = process.argv.slice(2);
const mode = args[0] && !args[0].startsWith("--") ? args.shift() : "default";
let limitMb = 1024;
let timeoutMs = 15 * 60_000;
let fileFilter = "";
for (const arg of args) {
  const [key, value] = arg.split("=", 2);
  if (
    key === "--limit-mb" &&
    Number.isInteger(Number(value)) &&
    Number(value) > 0
  ) {
    limitMb = Number(value);
  } else if (
    key === "--timeout-minutes" &&
    Number.isInteger(Number(value)) &&
    Number(value) > 0
  ) {
    timeoutMs = Number(value) * 60_000;
  } else if (key === "--file" && value) {
    fileFilter = value;
  } else {
    console.error(
      "Usage: node scripts/test-memory.js [default] [--file=substring] [--limit-mb=1024] [--timeout-minutes=15]",
    );
    process.exit(2);
  }
}
if (mode !== "default") {
  console.error(
    "Usage: node scripts/test-memory.js [default] [--file=substring] [--limit-mb=1024] [--timeout-minutes=15]",
  );
  process.exit(2);
}

const systemdRun =
  process.platform === "linux" &&
  spawnSync("systemd-run", ["--version"], { stdio: "ignore" }).status === 0;
if (process.platform === "linux" && !systemdRun) {
  console.warn(
    "systemd-run is unavailable; per-test measurements will not have a hard memory limit.",
  );
}

function processTreeRss(rootPid) {
  let entries;
  try {
    entries = readdirSync("/proc", { withFileTypes: true }).filter((entry) =>
      /^\d+$/.test(entry.name),
    );
  } catch {
    return 0;
  }

  const parentByPid = new Map();
  const rssByPid = new Map();
  for (const entry of entries) {
    const pid = Number(entry.name);
    try {
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const parent = status.match(/^PPid:\s+(\d+)$/m);
      const rss = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      if (parent && rss) {
        parentByPid.set(pid, Number(parent[1]));
        rssByPid.set(pid, Number(rss[1]));
      }
    } catch {
      // A process can exit while /proc is being sampled.
    }
  }

  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parent] of parentByPid) {
      if (!descendants.has(pid) && descendants.has(parent)) {
        descendants.add(pid);
        changed = true;
      }
    }
  }
  let total = 0;
  for (const pid of descendants) total += rssByPid.get(pid) || 0;
  return total;
}

function formatMb(kb) {
  return `${(kb / 1024).toFixed(0)} MiB`;
}

let activeChild;
let interruptedSignal;
function signalChild(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interruptedSignal = signal;
    if (activeChild) signalChild(activeChild, signal);
  });
}

async function runFile(file) {
  const command = systemdRun ? "systemd-run" : process.execPath;
  const commandArgs = systemdRun
    ? [
        "--user",
        "--scope",
        "--quiet",
        "-p",
        `MemoryMax=${limitMb}M`,
        "-p",
        "MemorySwapMax=0",
        "--",
        process.execPath,
        "--test",
        "--test-concurrency=1",
        file,
      ]
    : ["--test", "--test-concurrency=1", file];
  const child = spawn(command, commandArgs, {
    cwd: appRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=512"]
        .filter(Boolean)
        .join(" "),
    },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  let peakKb = 0;
  let timedOut = false;
  let forceStop;
  activeChild = child;
  const sampler = setInterval(() => {
    peakKb = Math.max(peakKb, processTreeRss(child.pid));
  }, 50);
  sampler.unref();
  const timeout = setTimeout(() => {
    timedOut = true;
    console.error(
      `${file} exceeded ${timeoutMs / 60_000} minutes; stopping it`,
    );
    signalChild(child, "SIGTERM");
    forceStop = setTimeout(() => signalChild(child, "SIGKILL"), 5000);
    forceStop.unref();
  }, timeoutMs);

  let code = 1;
  let signal;
  try {
    [code, signal] = await once(child, "close");
  } catch (error) {
    console.error(`${file} could not start: ${error.message}`);
  } finally {
    clearInterval(sampler);
    clearTimeout(timeout);
    clearTimeout(forceStop);
    if (activeChild === child) activeChild = undefined;
  }
  peakKb = Math.max(peakKb, processTreeRss(child.pid));
  const passed = code === 0 && !signal && !timedOut;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${formatMb(peakKb)} peak RSS  ${file}${signal ? ` (${signal})` : ""}`,
  );
  return { passed, peakKb, file };
}

const selectedFiles = defaultFiles.filter((file) => file.includes(fileFilter));
if (selectedFiles.length === 0) {
  console.error(`No test files matched ${JSON.stringify(fileFilter)}.`);
  process.exit(2);
}

console.log(
  `Measuring ${selectedFiles.length} test file${selectedFiles.length === 1 ? "" : "s"} sequentially; ${systemdRun ? `${limitMb} MiB hard limit per file, swap disabled` : "no hard memory limit"}.`,
);
console.log(
  "Peak RSS sums sampled process-tree RSS and may overcount shared memory; use it to compare files, not as exact cgroup usage.\n",
);

const results = [];
for (const file of selectedFiles) {
  if (interruptedSignal) break;
  results.push(await runFile(file));
}

const largest = [...results].sort((a, b) => b.peakKb - a.peakKb).slice(0, 10);
console.log("\nLargest sampled peaks:");
for (const result of largest) {
  console.log(`${formatMb(result.peakKb)}  ${result.file}`);
}
console.log(
  `\n${results.filter((result) => result.passed).length}/${results.length} test files passed${results.length < selectedFiles.length ? `; ${selectedFiles.length - results.length} not run` : ""}.`,
);
process.exitCode =
  interruptedSignal || !results.every((result) => result.passed) ? 1 : 0;
