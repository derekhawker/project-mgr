export function normalizedLabel(label) {
  return String(label ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export function groupTicketsByLabel(workspaces, ticketsForWorkspace) {
  const groups = new Map();
  for (const workspace of workspaces) {
    for (const ticket of ticketsForWorkspace(workspace.id)) {
      const label = (ticket.projectLabel?.trim() || workspace.name).replace(
        /\s+/gu,
        " ",
      );
      const key = normalizedLabel(label);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { key, label, tickets: [] });
      groups.get(key).tickets.push({ ticket, workspace });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      tickets: group.tickets.sort(
        (a, b) =>
          b.ticket.modifiedAt - a.ticket.modifiedAt ||
          a.ticket.title.localeCompare(b.ticket.title) ||
          a.workspace.name.localeCompare(b.workspace.name),
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const LABEL_COLOR_COUNT = 20;

export function labelColorIndex(label) {
  const normalized = normalizedLabel(label);
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % LABEL_COLOR_COUNT;
}
