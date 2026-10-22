export function resolveSessionReplacement(replacements, sessionId) {
  return replacements.get(sessionId) || sessionId;
}

export function recordSessionReplacement(replacements, navigation, staleSessionId, replacement) {
  replacements.set(staleSessionId, replacement.openCodeSessionId);
  navigation.sessions = (navigation.sessions || []).map((session) =>
    session.openCodeSessionId === staleSessionId
      ? { ...session, lastKnownStatus: 'missing' }
      : session);
  navigation.sessions.push(replacement);
  return replacement.openCodeSessionId;
}
