// Bounded, in-memory UI lifecycle diagnostics. Records contain only fixed
// component/event labels; never include workspace, ticket, or prompt data.
const counts = new Map();
const listeners = new Set();

export function recordUiDiagnostic(component, event) {
  const key = `${component}:${event}`;
  counts.set(key, (counts.get(key) || 0) + 1);
  for (const listener of listeners) listener();
}

export function getUiDiagnostics() {
  return Object.fromEntries(counts);
}

export function subscribeUiDiagnostics(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") window.appUiDiagnostics = getUiDiagnostics;
