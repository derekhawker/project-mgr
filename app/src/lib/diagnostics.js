// Deliberately record only fixed categories and manifest command names. Error
// messages, payloads, paths, and session identifiers may contain secrets.
const entries = [];
export function recordCommandFailure(command, category) {
  entries.push(
    Object.freeze({ time: new Date().toISOString(), command, category }),
  );
  if (entries.length > 100) entries.shift();
  console.error(`[app diagnostic] ${category}: ${command}`);
}
export function getDiagnostics() {
  return entries.map((entry) => ({ ...entry }));
}
if (typeof window !== "undefined") window.appDiagnostics = getDiagnostics;
