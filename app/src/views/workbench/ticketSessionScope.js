export function scopedSessionOwnerKey(ownerKey, scope) {
  return ownerKey?.startsWith("workspace:") && scope !== undefined
    ? `${ownerKey}|${scope || "none"}` : ownerKey;
}

export function sessionInTicketScope(entry, scope) {
  return scope === undefined || !entry.ownerKey?.startsWith("workspace:") ||
    Boolean(scope && entry.ticketScope === scope);
}
