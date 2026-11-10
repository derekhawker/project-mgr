import test from "node:test";
import assert from "node:assert/strict";
import {
  linkedTicketFilename,
  scopedSessionOwnerKey,
  sessionInTicketScope,
} from "../src/views/workspace/sessions/ticketSessionScope.js";

test("Workspace sessions and tools are visible only in their ticket scope", () => {
  const one = { ownerKey: "workspace:w", ticketScope: "one.md" };
  assert.equal(sessionInTicketScope(one, "one.md"), true);
  assert.equal(sessionInTicketScope(one, "two.md"), false);
  assert.equal(sessionInTicketScope(one, null), false);
  assert.notEqual(scopedSessionOwnerKey("workspace:w", "one.md"), scopedSessionOwnerKey("workspace:w", "two.md"));
  assert.equal(sessionInTicketScope({ ownerKey: "task:quick" }, null), true);
});

test("only saved ticket filenames are linked on close; ticket creation stays unbound", () => {
  assert.equal(linkedTicketFilename("ticket.md"), "ticket.md");
  assert.equal(linkedTicketFilename("__ticket_creation__"), undefined);
  assert.equal(linkedTicketFilename(null), undefined);
});
