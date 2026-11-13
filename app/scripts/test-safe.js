// Keep normal tests concurrent but bounded. Native builds and browser tests run
// in separate, serial cohorts when explicitly requested by test:all.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";

const appTests = new URL("../test/", import.meta.url);
const uiTests = new URL("../packages/ui-lib/test/", import.meta.url);
const appFiles = readdirSync(appTests).filter((name) =>
  name.endsWith(".test.js"),
);
const uiFiles = readdirSync(uiTests).filter((name) =>
  name.endsWith(".test.js"),
);
const browserFiles = appFiles
  .filter((name) => name.endsWith(".browser.test.js"))
  .map((name) => `test/${name}`);
const nativeFiles = [
  "test/model-loader-integration.test.js",
  "test/rust-wire-contract.integration.test.js",
];
const defaultFiles = [
  ...appFiles
    .filter(
      (name) =>
        !name.endsWith(".browser.test.js") &&
        !nativeFiles.includes(`test/${name}`),
    )
    .map((name) => `test/${name}`),
  ...uiFiles.map((name) => `packages/ui-lib/test/${name}`),
];

const mode = process.argv[2] || "default";
if (!["default", "all", "browser"].includes(mode)) {
  console.error("Usage: node scripts/test-safe.js [default|all|browser]");
  process.exit(2);
}

const env = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=512"]
    .filter(Boolean)
    .join(" "),
};
let active;

async function stopActive(signal = "SIGTERM") {
  if (!active || active.exitCode !== null || active.signalCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(active.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    await once(killer, "close").catch(() => {});
  } else {
    try {
      process.kill(-active.pid, signal);
    } catch {
      try {
        active.kill(signal);
      } catch {}
    }
  }
}

async function run(files, concurrency, label) {
  if (files.length === 0) return 0;
  console.log(`\n${label}: ${files.length} files, concurrency ${concurrency}`);
  const child = spawn(
    process.execPath,
    ["--test", `--test-concurrency=${concurrency}`, ...files],
    {
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    },
  );
  active = child;
  const timeout = setTimeout(() => {
    console.error(`${label} exceeded 15 minutes; stopping its process tree`);
    void stopActive("SIGTERM").then(() => {
      setTimeout(() => {
        if (active === child) void stopActive("SIGKILL");
      }, 5000).unref();
    });
  }, 15 * 60_000);
  try {
    const [code, signal] = await once(child, "close");
    if (signal) console.error(`${label} stopped by ${signal}`);
    return code ?? 1;
  } catch (error) {
    console.error(`${label} could not start: ${error}`);
    return 1;
  } finally {
    clearTimeout(timeout);
    active = undefined;
  }
}

process.on("SIGINT", () => void stopActive("SIGINT"));
process.on("SIGTERM", () => void stopActive("SIGTERM"));

let failed = false;
if (mode === "default") {
  failed = (await run(defaultFiles, 2, "Default tests")) !== 0;
} else if (mode === "browser") {
  failed = (await run(browserFiles, 1, "Browser tests")) !== 0;
} else {
  if ((await run(defaultFiles, 2, "Default tests")) !== 0) failed = true;
  for (const file of nativeFiles) {
    if ((await run([file], 1, `Native integration: ${file}`)) !== 0)
      failed = true;
  }
  if ((await run(browserFiles, 1, "Browser tests")) !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
