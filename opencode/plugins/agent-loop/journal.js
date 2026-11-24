import { createHash } from "node:crypto";
import { MAX_AGE, TURN_LIMIT } from "./loop.js";
import { companionPath } from "./workspace.js";

const version = 1;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const fingerprint = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const messageID = (value) => typeof value === "string" && /^[\w-]{1,128}$/.test(value);
const sessionID = (value) => typeof value === "string" && /^ses[\w-]{1,125}$/.test(value);
const reasonCode = (value) => typeof value === "string" && /^[a-z][a-z-]{0,79}$/.test(value);

// Storage is plugin-scoped, not location-scoped. The supported host is one
// server process; storage has no CAS. Share owners across plugin reloads in
// that process, including overlapping setup/cleanup of the same location.
const ownersKey = Symbol.for("project-mgr-agent-loop.journal-owners");
const owners = (globalThis[ownersKey] ??= new Set());
const draining = (globalThis[Symbol.for("project-mgr-agent-loop.journal-draining")] ??= new Set());
const vetoes = (globalThis[Symbol.for("project-mgr-agent-loop.journal-vetoes")] ??= new Map());
const listeners = (globalThis[Symbol.for("project-mgr-agent-loop.journal-listeners")] ??= new Map());
function claim(key) {
  if (owners.has(key)) return;
  owners.add(key);
  let held = true;
  return () => {
    if (held) owners.delete(key);
    held = false;
  };
}

export function createJournal(storage, location) {
  const identity = JSON.stringify([
    location.project.id, location.directory, location.workspaceID ?? null,
  ]);
  const key = `run/${hash(identity)}`;
  const terminalKey = (id) => `${key}/terminal/${hash(id)}`;
  const pending = (id) => `${key}/pause/${hash(id)}`;
  return {
    pendingPause: (id) => vetoes.get(pending(id)),
    rememberPause(id, reason) { vetoes.set(pending(id), reason); },
    clearPause(id, reason) {
      if (vetoes.get(pending(id)) === reason) vetoes.delete(pending(id));
    },
    confirmLoaded(sessionID) {
      const keep = sessionID && pending(sessionID);
      for (const entry of vetoes.keys()) {
        if (entry.startsWith(`${key}/pause/`) && entry !== keep) vetoes.delete(entry);
      }
    },
    requestStop(id) {
      vetoes.set(pending(id), "user-paused");
      for (const notify of listeners.get(key) ?? []) notify(id);
    },
    onStop(notify) {
      const active = listeners.get(key) ?? new Set();
      listeners.set(key, active);
      active.add(notify);
      return () => {
        active.delete(notify);
        if (!active.size) listeners.delete(key);
      };
    },
    claimLocation: () => claim(key),
    isDraining: () => draining.has(key),
    markDraining: () => draining.add(key),
    clearDraining: () => draining.delete(key),
    claimSession: (id) => claim(`session/${id}`),
    async load() {
      const r = await storage.get(key);
      if (r === undefined) return {};
      if (
        r?.version !== version || r.location !== identity ||
        !sessionID(r.sessionID) || !messageID(r.runID) ||
        !companionPath(r.ticket) || companionPath(r.ticket) !== r.todo ||
        !Number.isSafeInteger(r.started) || !Number.isSafeInteger(r.deadline) ||
        r.deadline <= r.started || r.deadline - r.started > MAX_AGE ||
        !Number.isSafeInteger(r.initialDeadline) ||
        r.initialDeadline < r.started || r.initialDeadline > r.deadline ||
        !Number.isInteger(r.turns) || r.turns < 0 || r.turns > TURN_LIMIT ||
        r.limit !== TURN_LIMIT || !["initial", "turn", "terminal"].includes(r.phase) ||
        !Number.isInteger(r.stalls) || r.stalls < 0 || r.stalls > 2 ||
        !Array.isArray(r.signatures) || r.signatures.length > 2 * r.turns ||
        !r.signatures.every(fingerprint) ||
        (r.phase === "initial" && r.turns !== 0) ||
        (r.initialLogAfter !== undefined && r.initialLogAfter !== null &&
          (!Number.isSafeInteger(r.initialLogAfter) || r.initialLogAfter < 0)) ||
        (r.phase === "terminal" ? !reasonCode(r.reason) : r.reason !== null) ||
        (r.turns === 0 ? r.turn !== null :
          !messageID(r.turn?.id) || !r.turn.id.startsWith("msg_") ||
          (r.turn.baseline !== null && !messageID(r.turn.baseline)) ||
          (r.turn.attempted !== undefined && typeof r.turn.attempted !== "boolean") ||
          (r.turn.previousID !== undefined && (!messageID(r.turn.previousID) || r.turn.baseline === null)) ||
          (r.turn.logAfter !== undefined && r.turn.logAfter !== null &&
            (!Number.isSafeInteger(r.turn.logAfter) || r.turn.logAfter < 0)) ||
          !fingerprint(r.turn.signature)) ||
        (r.phase === "turn" && !r.turn)
      ) return { reason: "recovery-record-invalid" };
      return { record: r };
    },
    save(r) {
      return storage.set(key, {
        version, location: identity, runID: r.runID, sessionID: r.sessionID,
        ticket: r.ticket, todo: r.todo, started: r.started, deadline: r.deadline,
        initialDeadline: r.initialDeadline, limit: r.limit, turns: r.turns,
        ...(r.initialLogAfter !== undefined && { initialLogAfter: r.initialLogAfter }),
        phase: r.state === "paused" ? "terminal" : r.turn ? "turn" : "initial",
        turn: r.turn ? {
          id: r.turn.id, baseline: r.turn.baseline, signature: r.turn.signature,
          ...(r.turn.logAfter !== undefined && { logAfter: r.turn.logAfter }),
          ...(r.turn.attempted !== undefined && { attempted: r.turn.attempted }),
          ...(r.turn.previousID !== undefined && { previousID: r.turn.previousID }),
        } : null,
        // Hashes, never checklist text. Preserve cycle detection across loads.
        stalls: r.stalls, signatures: [...r.signatures],
        reason: r.state === "paused" ? r.reason : null,
      });
    },
    archive(r) {
      return storage.set(terminalKey(r.sessionID), { version, turns: r.turns, reason: r.reason });
    },
    async terminal(id) {
      const r = await storage.get(terminalKey(id));
      if (r?.version === version && reasonCode(r.reason) &&
          Number.isInteger(r.turns) && r.turns >= 0 && r.turns <= TURN_LIMIT)
        return { state: "paused", reason: r.reason, turns: r.turns, limit: TURN_LIMIT };
    },
  };
}
