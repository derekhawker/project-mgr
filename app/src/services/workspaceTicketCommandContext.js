const commands = new Set([
  "change_review_load", "change_review_full_diff", "docs_list", "docs_read",
  "repo_tools_list", "repo_tool_terminal_start", "workbench_shell_terminal_start",
  "workbench_os_handoff",
]);

export function withSelectedTicketContext(name, payload, ticketFilename) {
  if (!commands.has(name) || !payload || !ticketFilename) return payload;
  const request = payload.request;
  if (request) {
    if (request.ownerType !== "workspace") return payload;
    return { ...payload, request: { ...request, ticketFilename } };
  }
  if (payload.ownerType !== "workspace") return payload;
  return { ...payload, ticketFilename };
}
