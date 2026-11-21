import { basename, dirname, isAbsolute, normalize } from "node:path";

export function companionPath(ticket) {
  return typeof ticket === "string" &&
    isAbsolute(ticket) &&
    normalize(ticket) === ticket &&
    !/[\x00-\x1f\x7f]/.test(ticket) &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(basename(ticket))
    ? `${ticket.slice(0, -3)}.todo`
    : undefined;
}

// The project-mgr Work action writes this string to the session's keyed entry.
// Its status may be stale; validateRecords reads the live Markdown status.
export async function discoverWorkspaceTicket(list, sessionID) {
  let entries;
  try {
    entries = await list();
  } catch {
    return { ok: false, reason: "workspace-ticket-entry-unavailable" };
  }
  if (!Array.isArray(entries))
    return { ok: false, reason: "workspace-ticket-entry-unavailable" };
  const matches = entries.filter((entry) => entry?.key === "workspace-ticket");
  const value = matches[0]?.value;
  if (!matches.length)
    return { ok: false, reason: "workspace-ticket-entry-required" };
  if (
    matches.length !== 1 ||
    typeof value !== "string" ||
    !value.startsWith("Work on ticket ")
  ) {
    return { ok: false, reason: "workspace-ticket-entry-malformed" };
  }
  const binding = value.split(
    `. Exact OpenCode session ID: ${sessionID}. Canonical ticket Markdown: `,
  );
  const fields =
    binding.length === 2 &&
    /^(.+?)\. Current status: [a-z_]+\. Workspace ticket directory: (.+?)\. Workspace repository root: /u.exec(
      binding[1],
    );
  if (!fields) return { ok: false, reason: "workspace-ticket-entry-malformed" };
  const [, ticket, directory] = fields;
  const todo = companionPath(ticket);
  if (!todo || directory !== dirname(ticket))
    return { ok: false, reason: "workspace-ticket-entry-malformed" };
  return { ok: true, ticket, todo };
}

export async function verifyWorkspaceTicket(list, sessionID, ticket) {
  const binding = await discoverWorkspaceTicket(list, sessionID);
  if (binding.ok && binding.ticket !== ticket)
    return { ok: false, reason: "workspace-ticket-path-mismatch" };
  return binding;
}
