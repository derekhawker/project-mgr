// Tab order is insertion order. Quick Requests retain an exact selection without
// having a tab; other owners prefer remembered, then selected, then first tabs.
export function ownerSessionTabState(
  entries,
  ownerKey,
  preferredId,
  hideTabs = false,
) {
  const ownerTabs = ownerKey
    ? entries.filter((entry) => entry.ownerKey === ownerKey)
    : [];
  const selectedId = hideTabs
    ? preferredId
    : (
        ownerTabs.find((entry) => entry.sessionId === preferredId) ||
        ownerTabs.find((entry) => entry.selected) ||
        ownerTabs[0]
      )?.sessionId;
  return {
    selectedId,
    entries: entries.map((entry) => ({
      ...entry,
      visible: !hideTabs && Boolean(ownerKey) && entry.ownerKey === ownerKey,
      selected:
        Boolean(ownerKey) &&
        entry.ownerKey === ownerKey &&
        entry.sessionId === selectedId,
    })),
  };
}

// Only restore orchestration lives here; the existing showSession adapter still
// owns exact-ID replacement, attachment, terminal nodes, and session evidence.
export async function restoreOwnerSessionTabs({
  owner,
  sessions,
  selectedSessionByOwner,
  openSessions,
  repositoryToolTerminals,
  getTabEntries,
  getSelectedOwnerKey,
  showSession,
}) {
  const ownerKey = `${owner.type}:${owner.id}`;
  const isCurrentOwner = () => getSelectedOwnerKey() === ownerKey;
  const tracked = (sessions || []).filter(
    (session) =>
      session.owner?.owner_type === owner.type &&
      session.owner?.owner_id === owner.id &&
      session.lastKnownStatus !== "missing",
  );
  if (!tracked.length || !isCurrentOwner()) return;
  const preferredId = selectedSessionByOwner.get(ownerKey);
  const preferred =
    tracked.find((session) => session.openCodeSessionId === preferredId) ||
    tracked.find((session) => openSessions.has(session.openCodeSessionId)) ||
    tracked[0];
  for (const session of tracked) {
    if (!isCurrentOwner()) return;
    await showSession(session.openCodeSessionId);
  }
  if (!isCurrentOwner()) return;
  const toolTab =
    repositoryToolTerminals.has(preferredId) &&
    getTabEntries().find(
      (entry) => entry.ownerKey === ownerKey && entry.sessionId === preferredId,
    );
  if (toolTab) toolTab.onSelect();
  else await showSession(preferred.openCodeSessionId);
}
