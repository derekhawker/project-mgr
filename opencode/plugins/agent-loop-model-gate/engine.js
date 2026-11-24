import { randomUUID } from "node:crypto";
import { sessionIDFromEvent } from "./event-scope.js";

const decisions = new Set(["continue", "complete", "blocked", "ask_user"]);
export const wakeEventTypes = Object.freeze([
  "session.idle",
  "session.status",
  "session.execution.succeeded",
  "session.instructions.updated",
  "session.created",
  "session.unarchived",
]);
const wakeEvents = new Set(wakeEventTypes);
const stateKey = (sessionID) => `session/${sessionID}`;
const evaluationKey = (sessionID) => `evaluation/${sessionID}`;
const evaluationStates = new Set(["ignored", "paused", "prompted"]);
const safeReason = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value)
    ? value
    : "evaluation-unavailable";

function readyTasks(ticketContent) {
  if (typeof ticketContent !== "string") return [];
  const lines = ticketContent.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.findIndex((line) => /^##\s+Tasks\s*#*\s*$/i.test(line));
  if (heading < 0) return [];
  const end = lines.findIndex((line, index) => index > heading && /^#{1,2}\s/.test(line));
  let fence;
  let deferred = false;
  const tasks = [];
  for (const line of lines.slice(heading + 1, end < 0 ? undefined : end)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const subheading = /^###\s+(.+?)\s*#*\s*$/.exec(line);
    if (subheading) {
      deferred = /^(explore later|follow[ -]?ups?|deferred)\s*$/i.test(subheading[1]);
      continue;
    }
    if (deferred) continue;
    const task = /^\s*(?:[-+*]|\d+\.)\s+\[ \]\s+([^\r\n]+)$/.exec(line)?.[1]?.trim();
    if (task) tasks.push(task);
  }
  return tasks;
}

export function parseDecision(text, ticketContent) {
  if (typeof text !== "string") return;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "decision,reason,task" ||
    !decisions.has(value.decision) ||
    typeof value.reason !== "string" ||
    !value.reason.trim() ||
    value.reason.length > 280 ||
    (value.decision === "continue"
      ? typeof value.task !== "string" || !readyTasks(ticketContent).includes(value.task)
      : value.task !== null)
  )
    return;
  return { decision: value.decision, reason: value.reason, task: value.task };
}

export function createModelGate({
  api,
  storage,
  now = Date.now,
  maxTurns = 400,
  maxAge = 3 * 60 * 60_000,
}) {
  const inFlight = new Map();
  const stateWrites = new Map();
  const observedEvents = new Map();
  const stopRequested = new Set();
  let closed = false;
  let eventStreamState;

  const state = async (sessionID) => {
    const value = await storage.get(stateKey(sessionID));
    if (value === undefined) return { turns: 0, startedAt: now(), stopped: false };
    if (
      !value ||
      value.sessionID !== sessionID ||
      !Number.isSafeInteger(value.turns) ||
      value.turns < 0 ||
      !Number.isFinite(value.startedAt) ||
      typeof value.stopped !== "boolean" ||
      !(value.lastIdleID === undefined || typeof value.lastIdleID === "string")
    )
      return;
    return value;
  };

  async function updateState(sessionID, update, { allowStopped = false } = {}) {
    const previous = stateWrites.get(sessionID) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      const current = await state(sessionID);
      if (!current) throw new Error("state-unavailable");
      if (!allowStopped && (current.stopped || stopRequested.has(sessionID)))
        throw new Error("user-stopped");
      const next = update(current);
      await storage.set(stateKey(sessionID), next);
      return next;
    });
    stateWrites.set(sessionID, write);
    try {
      return await write;
    } finally {
      if (stateWrites.get(sessionID) === write) stateWrites.delete(sessionID);
    }
  }

  function recordEvent(sessionID, type) {
    observedEvents.set(sessionID, { receivedAt: now(), type });
  }

  async function consider(sessionID) {
    if (closed || typeof sessionID !== "string" || inFlight.has(sessionID))
      return { state: "ignored", reason: "already-checking-or-closed" };
    const operation = run(sessionID);
    inFlight.set(sessionID, operation);
    try {
      const result = await operation;
      await storage.set(evaluationKey(sessionID), {
        checkedAt: now(),
        state: evaluationStates.has(result?.state) ? result.state : "paused",
        reason: safeReason(result?.reason),
      }).catch(() => {});
      return result;
    } catch {
      const result = { state: "paused", reason: "evaluation-unavailable" };
      await storage.set(evaluationKey(sessionID), {
        checkedAt: now(),
        ...result,
      }).catch(() => {});
      return result;
    } finally {
      if (inFlight.get(sessionID) === operation) inFlight.delete(sessionID);
    }
  }

  async function run(sessionID) {
    if (closed) return { state: "paused", reason: "plugin-unloaded" };
    const binding = await api.binding(sessionID);
    if (!binding?.ok) return { state: "ignored", reason: binding?.reason ?? "ticket-unavailable" };
    const saved = await state(sessionID);
    if (!saved) return { state: "paused", reason: "state-unavailable" };
    if (saved.stopped || stopRequested.has(sessionID)) return { state: "paused", reason: "user-stopped" };
    if (saved.turns >= maxTurns || now() - saved.startedAt >= maxAge)
      return { state: "paused", reason: "limit-reached" };

    const boundary = await api.hardCheck(sessionID, binding);
    if (!boundary?.ok) return { state: "paused", reason: boundary?.reason ?? "hard-check-failed" };
    if (
      typeof boundary.idleID !== "string" ||
      !boundary.idleID ||
      typeof boundary.lastMessage !== "string" ||
      !boundary.lastMessage.trim()
    )
      return { state: "paused", reason: "last-turn-unavailable" };
    if (saved.lastIdleID === boundary.idleID)
      return { state: "ignored", reason: "idle-already-evaluated" };

    let reserved;
    try {
      // Claim this idle boundary before an auxiliary model call so duplicate
      // events cannot launch parallel or repeated evaluations.
      reserved = await updateState(sessionID, (current) => ({
        ...current,
        sessionID,
        lastIdleID: boundary.idleID,
      }));
    } catch {
      return { state: "paused", reason: stopRequested.has(sessionID) ? "user-stopped" : "state-write-failed" };
    }

    let raw;
    try {
      raw = await api.decide({
        sessionID,
        ticket: binding.ticket,
        ticketContent: binding.ticketContent,
        lastMessage: boundary.lastMessage,
      });
    } catch {
      return { state: "paused", reason: "decision-unavailable" };
    }
    const decision = parseDecision(raw, binding.ticketContent);
    if (!decision) return { state: "paused", reason: "decision-invalid" };

    // Recheck every hard condition after the model call. A stop, new user input,
    // changed binding, or new turn during generation wins over `continue`.
    const currentBinding = await api.binding(sessionID);
    const currentBoundary = currentBinding?.ok
      ? await api.hardCheck(sessionID, currentBinding)
      : undefined;
    const latest = await state(sessionID);
    if (!latest) return { state: "paused", reason: "state-unavailable" };
    if (closed) return { state: "paused", reason: "plugin-unloaded" };
    if (latest.stopped || stopRequested.has(sessionID)) return { state: "paused", reason: "user-stopped" };
    if (
      !currentBinding?.ok ||
      currentBinding.ticket !== binding.ticket ||
      currentBinding.signature !== binding.signature
    )
      return { state: "paused", reason: "ticket-changed" };
    if (!currentBoundary?.ok) return { state: "paused", reason: currentBoundary?.reason ?? "hard-check-failed" };
    if (
      currentBoundary.idleID !== boundary.idleID ||
      currentBoundary.lastMessage !== boundary.lastMessage
    )
      return { state: "paused", reason: "session-changed-during-decision" };

    if (decision.decision !== "continue")
      return { state: "paused", reason: decision.decision, detail: decision.reason };

    const finalState = await state(sessionID);
    if (closed) return { state: "paused", reason: "plugin-unloaded" };
    if (!finalState || finalState.stopped || stopRequested.has(sessionID))
      return { state: "paused", reason: finalState ? "user-stopped" : "state-unavailable" };
    let next;
    try {
      next = await updateState(sessionID, (current) => ({
        ...current,
        sessionID,
        turns: current.turns + 1,
      }));
    } catch {
      return { state: "paused", reason: stopRequested.has(sessionID) ? "user-stopped" : "state-write-failed" };
    }
    if (stopRequested.has(sessionID)) return { state: "paused", reason: "user-stopped" };
    const admissionBinding = await api.binding(sessionID);
    if (
      !admissionBinding?.ok ||
      admissionBinding.ticket !== binding.ticket ||
      admissionBinding.signature !== binding.signature
    )
      return { state: "paused", reason: "ticket-changed" };
    const admissionBoundary = await api.hardCheck(sessionID, admissionBinding);
    if (!admissionBoundary?.ok)
      return { state: "paused", reason: admissionBoundary?.reason ?? "hard-check-failed" };
    if (
      admissionBoundary.idleID !== boundary.idleID ||
      admissionBoundary.lastMessage !== boundary.lastMessage
    )
      return { state: "paused", reason: "session-changed-during-decision" };
    const finalBinding = await api.binding(sessionID);
    if (
      !finalBinding?.ok ||
      finalBinding.ticket !== binding.ticket ||
      finalBinding.signature !== binding.signature
    )
      return { state: "paused", reason: "ticket-changed" };
    if (closed) return { state: "paused", reason: "plugin-unloaded" };
    if (stopRequested.has(sessionID)) return { state: "paused", reason: "user-stopped" };
    try {
      await api.prompt({
        sessionID,
        id: `msg_${randomUUID()}`,
        ticket: binding.ticket,
        task: decision.task,
        reason: decision.reason,
      });
      return { state: "prompted", turns: next.turns };
    } catch {
      return { state: "paused", reason: "prompt-admission-failed" };
    }
  }

  return {
    async event(event) {
      if (!wakeEvents.has(event?.type))
        return { state: "ignored", reason: "event-not-relevant" };
      if (
        event.type === "session.status" &&
        (event.properties?.status ?? event.data?.status)?.type !== "idle"
      )
        return { state: "ignored", reason: "session-not-idle" };
      const sessionID = sessionIDFromEvent(event);
      if (typeof sessionID === "string") recordEvent(sessionID, event.type);
      return consider(sessionID);
    },
    async scan() {
      const sessions = await api.sessions();
      if (!Array.isArray(sessions)) return { state: "paused", reason: "session-list-unavailable" };
      const results = [];
      for (const sessionID of new Set(sessions.filter((id) => typeof id === "string")))
        results.push(await consider(sessionID));
      return results;
    },
    async stop(sessionID) {
      if (typeof sessionID !== "string") return { state: "paused", reason: "session-id-required" };
      stopRequested.add(sessionID);
      try {
        await updateState(sessionID, (saved) => ({ ...saved, sessionID, stopped: true }), {
          allowStopped: true,
        });
        return { state: "paused", reason: "user-stopped" };
      } catch {
        return { state: "paused", reason: "stop-not-saved" };
      }
    },
    async status(sessionID) {
      if (typeof sessionID !== "string") return { state: "paused", reason: "session-id-required" };
      let preflight;
      if (typeof api.diagnose === "function") {
        try {
          const current = await api.diagnose(sessionID);
          preflight = {
            state: ["ready", "paused", "unavailable"].includes(current?.state)
              ? current.state
              : "unavailable",
            reason: safeReason(current?.reason),
          };
        } catch {
          preflight = { state: "unavailable", reason: "diagnostic-unavailable" };
        }
      }
      try {
        const saved = await storage.get(evaluationKey(sessionID));
        let eventReceipt = observedEvents.get(sessionID);
        if (
          !eventReceipt ||
          !Number.isFinite(eventReceipt.receivedAt) ||
          !wakeEvents.has(eventReceipt.type)
        )
          eventReceipt = undefined;
        if (
          !saved ||
          !Number.isFinite(saved.checkedAt) ||
          !evaluationStates.has(saved.state) ||
          typeof saved.reason !== "string" ||
          !/^[a-z][a-z0-9-]{0,63}$/.test(saved.reason)
        )
          return {
            state: "unavailable",
            reason: "no-evaluation-recorded",
            ...(eventStreamState && { eventStream: eventStreamState }),
            ...(preflight && { preflight }),
            ...(eventReceipt && { lastEvent: eventReceipt }),
          };
        return {
          checkedAt: saved.checkedAt,
          state: saved.state,
          reason: saved.reason,
          ...(eventStreamState && { eventStream: eventStreamState }),
          ...(preflight && { preflight }),
          ...(eventReceipt && { lastEvent: eventReceipt }),
        };
      } catch {
        return {
          state: "unavailable",
          reason: "status-unavailable",
          ...(eventStreamState && { eventStream: eventStreamState }),
          ...(preflight && { preflight }),
        };
      }
    },
    close() {
      closed = true;
      eventStreamState = "closed";
    },
    setEventStreamState(state) {
      if (["starting", "listening", "retrying", "closed"].includes(state))
        eventStreamState = state;
    },
  };
}
