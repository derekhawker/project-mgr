import assert from "node:assert/strict";
import test from "node:test";
import { withSelectedTicketContext } from "../src/services/workspaceTicketCommandContext.js";

const commands = [
  "change_review_load", "change_review_full_diff", "docs_list", "docs_read",
  "repo_tools_list", "repo_tool_terminal_start", "workbench_shell_terminal_start",
  "workbench_os_handoff",
];

test("workspace commands receive the exact selected ticket filename", () => {
  for (const name of commands) {
    const request = { ownerType: "workspace", ownerId: "ws-1", path: "README.md" };
    assert.deepEqual(
      withSelectedTicketContext(name, { request }, "ticket-exact.md"),
      { request: { ...request, ticketFilename: "ticket-exact.md" } },
    );
    assert.deepEqual(withSelectedTicketContext(name, request, "ticket-exact.md"),
      { ...request, ticketFilename: "ticket-exact.md" });
  }
});

test("ticket context is absent without selection or for non-workspace commands", () => {
  const payload = { request: { ownerType: "workspace", ownerId: "ws-1" } };
  assert.equal(withSelectedTicketContext("docs_list", payload, null), payload);
  assert.equal(withSelectedTicketContext("workspace_list", payload, "ticket.md"), payload);
  const nonWorkspace = { request: { ownerType: "quick_request", ownerId: "qr-1" } };
  assert.equal(withSelectedTicketContext("docs_list", nonWorkspace, "ticket.md"), nonWorkspace);
});
