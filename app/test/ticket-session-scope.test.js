import test from "node:test";
import assert from "node:assert/strict";
import { scopedSessionOwnerKey, sessionInTicketScope } from "../src/views/workspace/sessions/ticketSessionScope.js";

test("Workspace sessions and tools are visible only in their ticket scope", () => {
  const one = { ownerKey: "workspace:w", ticketScope: "one.md" };
  assert.equal(sessionInTicketScope(one, "one.md"), true);
  assert.equal(sessionInTicketScope(one, "two.md"), false);
  assert.equal(sessionInTicketScope(one, null), false);
  assert.notEqual(scopedSessionOwnerKey("workspace:w", "one.md"), scopedSessionOwnerKey("workspace:w", "two.md"));
  assert.equal(sessionInTicketScope({ ownerKey: "task:quick" }, null), true);
});
