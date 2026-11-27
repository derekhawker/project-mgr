import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const runner = path.join(root, "scripts/test-safe.js");

// The shim records commands but never executes the node test command it receives.
function fixture(t, { shim = true, fail = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "safe-runner-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "calls");
  if (shim) {
    const executable = path.join(dir, "systemd-run");
    writeFileSync(
      executable,
      `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');\nif (args[0] !== '--version' && ${fail}) process.exit(17);\n`,
    );
    chmodSync(executable, 0o755);
  }
  return {
    run: (...args) =>
      spawnSync(process.execPath, [runner, ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, PATH: dir },
      }),
    calls: () => {
      try {
        return readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse)
          .filter((args) => args[0] !== "--version");
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
  };
}

function assertScoped(calls, files, name) {
  const actual = [];
  for (const args of calls) {
    assert.ok(args.includes("--user"));
    assert.ok(args.includes("--scope"));
    assert.ok(args.includes("MemoryMax=1G"));
    assert.ok(args.includes("MemorySwapMax=0"));
    assert.ok(args.includes(process.execPath));
    const selected = args.filter((arg) => arg.endsWith(".test.js"));
    assert.ok(selected.length >= 1, JSON.stringify(args));
    const vitest = selected[0].endsWith(".vitest.test.js");
    assert.ok(
      selected.every((file) => file.endsWith(".vitest.test.js") === vitest),
    );
    assert.ok(args.includes(vitest ? "run" : "--test"));
    if (!vitest) assert.equal(selected.length, 1);
    actual.push(...selected);
    if (name)
      assert.ok(
        args.includes(
          vitest ? `--testNamePattern=${name}` : `--test-name-pattern=${name}`,
        ),
        JSON.stringify(args),
      );
  }
  assert.deepEqual(actual.sort(), [...files].sort());
}

test("selected app and UI files run in separate capped scopes with the name filter", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  const f = fixture(t);
  const files = [
    "test/command-contract.test.js",
    "packages/ui-lib/test/button.test.js",
  ];
  // Select an actual UI file without coupling this test to a component name.
  files[1] = `packages/ui-lib/test/${readdirSync(path.join(root, "packages/ui-lib/test")).find((file) => file.endsWith(".test.js"))}`;
  const result = f.run("default", ...files, "--name=success|failure");
  assert.equal(result.status, 0, result.stderr);
  assertScoped(f.calls(), files, "success|failure");
});

test("selected Vitest files share a bounded invocation and receive the name filter", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  const f = fixture(t);
  const files = [
    "test/ui-dom.vitest.test.js",
    "test/workspace-ticket-viewer-dom.vitest.test.js",
  ];
  const result = f.run("default", ...files, "--name=menu");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.calls().length, 1);
  assertScoped(f.calls(), files, "menu");
});

test("mixed selections run Node files before the consolidated Vitest group", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  const f = fixture(t);
  const result = f.run(
    "default",
    "test/ui-dom.vitest.test.js",
    "test/command-contract.test.js",
    "test/workspace-ticket-viewer-dom.vitest.test.js",
  );
  assert.equal(result.status, 0, result.stderr);
  const calls = f.calls();
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("test/command-contract.test.js"));
  assert.ok(calls[1].includes("test/ui-dom.vitest.test.js"));
  assert.ok(
    calls[1].includes("test/workspace-ticket-viewer-dom.vitest.test.js"),
  );
});

test("invalid selection and arguments never start a test", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  for (const args of [
    ["default", "test/not-a-real-test.test.js"],
    [
      "default",
      "test/command-contract.test.js",
      "test/not-a-real-test.test.js",
    ],
    ["default", "--unknown"],
    ["default", "--name=["],
    ["not-a-cohort"],
  ]) {
    const f = fixture(t);
    const result = f.run(...args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.deepEqual(f.calls(), [], JSON.stringify(args));
  }
});

test("missing systemd-run fails closed", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  const f = fixture(t, { shim: false });
  const result = f.run("default", "test/command-contract.test.js");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /systemd/i);
  assert.deepEqual(f.calls(), []);
});

test("a scope failure propagates as a failed run", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  const f = fixture(t, { fail: true });
  const result = f.run(
    "default",
    "test/command-contract.test.js",
    "test/ui-dom.vitest.test.js",
  );
  assert.notEqual(result.status, 0);
  assertScoped(f.calls(), ["test/command-contract.test.js"]);
});

test("plugin test scripts use the bounded runner and accept selected files", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  for (const plugin of ["agent-loop", "agent-loop-model-gate"]) {
    const directory = path.join(root, "../opencode/plugins", plugin);
    const manifest = JSON.parse(
      readFileSync(path.join(directory, "package.json"), "utf8"),
    );
    assert.equal(
      manifest.scripts.test,
      `node ../../../app/scripts/test-safe.js default --plugin=${plugin}`,
    );
    const file = readdirSync(directory).find((name) =>
      name.endsWith(".test.js"),
    );
    const f = fixture(t);
    const result = f.run("default", `--plugin=${plugin}`, file);
    assert.equal(result.status, 0, result.stderr);
    assertScoped(f.calls(), [`../opencode/plugins/${plugin}/${file}`]);
  }
});

test("UI library workspace routes its files through the scoped runner", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  const manifest = JSON.parse(
    readFileSync(path.join(root, "packages/ui-lib/package.json"), "utf8"),
  );
  assert.equal(
    manifest.scripts.test,
    "node ../../scripts/test-safe.js default --ui-lib",
  );
  const f = fixture(t);
  const file = readdirSync(path.join(root, "packages/ui-lib/test")).find(
    (name) => name.endsWith(".test.js"),
  );
  const result = f.run("default", "--ui-lib", `test/${file}`);
  assert.equal(result.status, 0, result.stderr);
  assertScoped(f.calls(), [`packages/ui-lib/test/${file}`]);
});

test("browser cohort selects only browser files, each under a cap", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  const f = fixture(t);
  const files = readdirSync(path.join(root, "test"))
    .filter((file) => file.endsWith(".browser.test.js"))
    .map((file) => `test/${file}`);
  const result = f.run("browser");
  assert.equal(result.status, 0, result.stderr);
  assertScoped(f.calls(), files);
});

test("default and all cohorts include the correct files under per-file caps", (t) => {
  if (process.platform !== "linux") return t.skip("Linux scope contract");
  const appFiles = readdirSync(path.join(root, "test"))
    .filter((file) => file.endsWith(".test.js"))
    .map((file) => `test/${file}`);
  const uiFiles = readdirSync(path.join(root, "packages/ui-lib/test"))
    .filter((file) => file.endsWith(".test.js"))
    .map((file) => `packages/ui-lib/test/${file}`);
  const native = [
    "test/model-loader-integration.test.js",
    "test/rust-wire-contract.integration.test.js",
  ];
  const defaults = [
    ...appFiles.filter(
      (file) => !file.endsWith(".browser.test.js") && !native.includes(file),
    ),
    ...uiFiles,
  ];
  for (const [mode, files] of [
    ["default", defaults],
    ["all", [...appFiles, ...uiFiles]],
  ]) {
    const f = fixture(t);
    const result = f.run(mode);
    assert.equal(result.status, 0, result.stderr);
    assertScoped(f.calls(), files);
  }
});
