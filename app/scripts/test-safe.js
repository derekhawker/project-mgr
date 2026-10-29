// The explicit installed-CLI integration test starts a real OpenCode server.
// Keep it out of the default local test entry point.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync(new URL("../test/", import.meta.url))
  .filter(
    (name) =>
      name.endsWith(".test.js") &&
      name !== "model-loader-integration.test.js" &&
      !name.endsWith(".browser.test.js"),
  )
  .map((name) => `test/${name}`);
files.push(
  ...readdirSync(new URL("../packages/ui-lib/test/", import.meta.url))
    .filter((name) => name.endsWith(".test.js") && !name.endsWith(".browser.test.js"))
    .map((name) => `packages/ui-lib/test/${name}`),
);
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
