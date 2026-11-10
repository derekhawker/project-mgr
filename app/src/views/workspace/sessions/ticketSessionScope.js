export function scopedSessionOwnerKey(ownerKey, scope) {
  return ownerKey?.startsWith("workspace:") && scope !== undefined
    ? `${ownerKey}|${scope || "none"}` : ownerKey;
}

export function sessionInTicketScope(entry, scope) {
  return scope === undefined || !entry.ownerKey?.startsWith("workspace:") ||
    Boolean(scope && entry.ticketScope === scope);
}

export function linkedTicketFilename(scope) {
  return typeof scope === "string" && scope.length > 0 && scope !== "__ticket_creation__"
    ? scope
    : undefined;
}
