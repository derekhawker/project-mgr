import test from "node:test";
import assert from "node:assert/strict";
import {
  attachReplacementBeforeClosingPrevious,
  linkedTicketFilename,
  scopedSessionOwnerKey,
  sessionInTicketScope,
  ticketFilenameForSessionClose,
  TICKET_SESSION_TAB_LABEL,
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
  assert.equal(TICKET_SESSION_TAB_LABEL, "OpenCode");
  assert.equal(linkedTicketFilename("ticket.md"), "ticket.md");
  assert.equal(linkedTicketFilename("__ticket_creation__"), undefined);
  assert.equal(linkedTicketFilename(null), undefined);
});

test("closing a repository-tool terminal does not close its owning ticket session", () => {
  const entry = { ownerKey: "workspace:w", ticketScope: "ticket.md" };
  assert.equal(ticketFilenameForSessionClose(entry, "ticket.md", true), undefined);
  assert.equal(ticketFilenameForSessionClose(entry, "ticket.md", false), "ticket.md");
});

test("new ticket session attaches before closing the previous terminal", async () => {
  const calls = [];
  await attachReplacementBeforeClosingPrevious(
    "ses-old",
    "ses-new",
    async () => calls.push("attach-new"),
    async (sessionId) => calls.push(`close-${sessionId}`),
  );
  assert.deepEqual(calls, ["attach-new", "close-ses-old"]);
});

test("failed replacement attachment keeps the previous terminal open", async () => {
  const calls = [];
  await assert.rejects(attachReplacementBeforeClosingPrevious(
    "ses-old",
    "ses-new",
    async () => { throw new Error("attach failed"); },
    async (sessionId) => calls.push(`close-${sessionId}`),
  ), /attach failed/);
  assert.deepEqual(calls, []);
});
