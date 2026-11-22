import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexSource = await readFile(new URL("./index.js", import.meta.url), "utf8");

test("event subscription uses the engine's shared wake-event list", () => {
  assert.match(indexSource, /import\s*\{[^}]*\bwakeEventTypes\b[^}]*\}\s*from\s*"\.\/engine\.js"/s);
  assert.match(indexSource, /ctx\.event\.subscribe\(\s*\{\s*types:\s*wakeEventTypes\s*,/s);
  assert.match(indexSource, /eventOwnerSessionIDs\(ctx,\s*\[sessionID\]\)/);
  assert.match(indexSource, /sessionIDFromEvent\(event\)/);
  assert.match(indexSource, /if\s*\(!allowedSessionIDs\.includes\(sessionID\)\)\s*return/);
  assert.doesNotMatch(indexSource, /ctx\.event\.subscribe\(\s*\{\s*types:\s*\[/s);
});
