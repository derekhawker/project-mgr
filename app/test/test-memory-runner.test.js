import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const runner = path.join(appRoot, "scripts/test-memory.js");

function run(args, options = {}) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: appRoot,
    encoding: "utf8",
    timeout: 10_000,
    ...options,
  });
}

test("--file restricts the run and reports an unmatched filter", () => {
  const result = run(["--file=not-a-real-test-file"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /No test files matched "not-a-real-test-file"/);
  assert.doesNotMatch(result.stdout, /Measuring \d+ test file/);
});

test("Linux systemd execution passes the per-file memory cap and serial node test flags", (t) => {
  if (process.platform !== "linux") {
    t.skip("systemd-run memory caps are Linux-specific");
    return;
  }

  const temp = mkdtempSync(path.join(tmpdir(), "test-memory-runner-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const invocations = path.join(temp, "invocations.jsonl");
  const shim = path.join(temp, "systemd-run");
  writeFileSync(
    shim,
    `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nconst args = process.argv.slice(2);\nif (args[0] !== "--version") appendFileSync(${JSON.stringify(invocations)}, JSON.stringify(args) + "\\n");\n`,
  );
  chmodSync(shim, 0o755);

  const result = run(["--file=command-contract.test.js", "--limit-mb=64"], {
    env: { ...process.env, PATH: `${temp}${path.delimiter}${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Measuring 1 test file sequentially; 64 MiB hard limit per file, swap disabled/,
  );
  assert.match(
    result.stdout,
    /PASS \d+ MiB peak RSS  test\/command-contract\.test\.js/,
  );
  const [args] = readFileSync(invocations, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(args, [
    "--user",
    "--scope",
    "--quiet",
    "-p",
    "MemoryMax=64M",
    "-p",
    "MemorySwapMax=0",
    "--",
    process.execPath,
    "--test",
    "--test-concurrency=1",
    "test/command-contract.test.js",
  ]);
});
