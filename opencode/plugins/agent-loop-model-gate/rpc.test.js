import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rpcSource = await readFile(new URL("./rpc.js", import.meta.url), "utf8");

test("status RPC accepts only a bounded session ID and returns safe status metadata", () => {
  // The OpenCode plugin SDK is supplied by the host runtime, not this package's
  // test environment, so protect the schema declaration at its source boundary.
  assert.match(rpcSource, /export const id = "project-mgr-agent-loop-model-gate"/);
  assert.match(rpcSource, /status:\s*\{\s*input:\s*object\(\{\s*sessionID\s*\}\)/s);
  assert.match(rpcSource, /const sessionID = \{ type: "string", minLength: 1, maxLength: 128 \}/);
  assert.match(rpcSource, /checkedAt:\s*\{ type: "number" \}/);
  assert.match(rpcSource, /state:\s*\{ type: "string", enum: \["ignored", "paused", "prompted", "unavailable"\] \}/);
  assert.match(rpcSource, /reason:\s*\{ type: "string", maxLength: 64 \}/);
  assert.match(rpcSource, /\}, \["state", "reason"\]\)/);
  assert.match(rpcSource, /errors:\s*\{\}/);
  assert.doesNotMatch(rpcSource, /(?:transcript|explanation|taskText):/);
});
