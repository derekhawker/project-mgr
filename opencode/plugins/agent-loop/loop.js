import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

export const TURN_LIMIT = 400;
export const MAX_AGE = 3 * 60 * 60_000;
const RECOVERY_NOTICE =
  "The previous response was interrupted. Continue from where you left off without repeating completed content.";
const SAFETY_EVENTS = new Map([
  ["permission.asked", "permission-requested"],
  ["form.created", "form-requested"],
  ["session.execution.interrupted", "execution-interrupted"],
  ["session.execution.failed", "execution-failed"],
  ["session.moved", "session-moved"],
  ["session.archived", "session-archived"],
  ["session.deleted", "session-deleted"],
]);
export const vetoTypes = [
  ...SAFETY_EVENTS.keys(),
  "session.inbox.enqueued",
  "session.inbox.cancelled",
];

// Messages are newest first. Previous durable idle must be the immediate
// predecessor of our input. No other input or second idle may follow it.
export function reconcile(messages, id, baseline, truncated) {
  if (!Array.isArray(messages)) return { reason: "turn-boundary-ambiguous" };
  const index = messages.findIndex((message) => message?.id === id);
  if (index < 0) return { reason: "own-prompt-not-in-history" };
  if (
    messages[index].type !== "user" ||
    (messages[index + 1]?.id ?? null) !== baseline ||
    (!messages[index + 1] && truncated)
  ) {
    return { reason: "turn-boundary-ambiguous" };
  }
  const work = messages.slice(0, index);
  if (
    work.some(
      (message) =>
        message?.type !== "assistant" &&
        message?.type !== "compaction" &&
        message?.type !== "idle" &&
        !isRecoveryNotice(message),
    )
  )
    return { reason: "turn-boundary-ambiguous" };
  // Session snapshots can report the prior idle time while the admitted turn
  // is still running. Wait for its durable idle marker rather than treating an
  // in-progress assistant message as evidence of an ambiguous boundary.
  if (work[0]?.type !== "idle") {
    if (work.some((message) => message?.type === "idle"))
      return { reason: "turn-boundary-ambiguous" };
    return { pending: true };
  }
  const [idle, ...completedWork] = work;
  if (
    typeof idle.id !== "string" ||
    !idle.id ||
    completedWork.some(
      (message) =>
        message?.type !== "assistant" &&
        message?.type !== "compaction" &&
        !isRecoveryNotice(message),
    )
  )
    return { reason: "turn-boundary-ambiguous" };
  if (idle.outcome !== "succeeded")
    return { reason: "execution-not-successful" };
  const final = completedWork[0];
  if (
    final?.type !== "assistant" ||
    final.finish !== "stop" ||
    !Number.isFinite(final.time?.completed) ||
    !Array.isArray(final.content) ||
    final.content.some(
      (part) =>
        typeof part?.type !== "string" ||
        (part.type === "text" && typeof part.text !== "string"),
    ) ||
    final.error
  )
    return { reason: "completion-unconfirmed" };
  const text = final.content
    .filter(({ type }) => type === "text")
    .map(({ text }) => text)
    .join("\n");
  const checkpoint = text.trimEnd().split("\n").at(-1);
  return {
    idle: idle.id,
    checkpoint: ["ready", "blocked", "complete"].find(
      (state) => checkpoint === `Agent loop checkpoint: ${id} ${state}`,
    ),
  };
}

function isRecoveryNotice(message) {
  return message?.type === "synthetic" && message.text === RECOVERY_NOTICE;
}

function promptText({ ticket, todo, id }) {
  return `Continue the approved ticket using @agent-loop. Reread the authoritative ticket ${JSON.stringify(ticket)} and TODO file ${JSON.stringify(todo)}, including after compaction. The ticket defines outcomes and acceptance; the TODO file is the single actionable plan. Reconcile the whole plan at the start and end of this turn. Write the TODO file only when an approved task, its order/dependency, or a blocker materially changes; reconciliation alone is not a reason to write. Keep only actionable approved tasks in TODO. Keep at most three brief, unapproved topics under “Explore later”; do not append turn history, repeated validation results, or general progress summaries. Preserve concise proof only when it changes task readiness or acceptance. Continue ready approved unblocked work; do not stop after one task while more remains. Leave permissions, forms, destructive actions, user-data cutover, closeout and human-only acceptance to the user. Report the work briefly or name the exact human gate, then end with the line “Agent loop checkpoint: ${id} ready”, replacing ready with blocked if only human decision/permission/access remains (or records are unavailable), or complete only with verified completion.`;
}

export function createLoop({
  api,
  delay = (signal) => sleep(2000, undefined, { signal }),
  maxAge = MAX_AGE,
  startupIdleGrace = 0,
}) {
  let run;
  let closed = false;
  const active = (r) => run === r && r.state === "active" && !closed;
  function pause(reason) {
    if (run?.state !== "active") return;
    run.state = "paused";
    run.reason = reason;
    clearTimeout(run.timer);
    run.abort.abort();
  }
  function status(sessionID) {
    return run?.sessionID === sessionID
      ? {
          state: run.state,
          reason: run.reason,
          turns: run.turns,
          limit: run.limit,
        }
      : { state: "off", reason: "not-armed" };
  }
  async function schedule(r, expectedIdle) {
    const waitForInitialIdle = expectedIdle === undefined;
    const deadline = Date.now() + (waitForInitialIdle ? startupIdleGrace : 0);
    while (active(r)) {
      const snapshot = await api.snapshot(r, r.abort.signal);
      if (!active(r)) return;
      if (snapshot.reason) return pause(snapshot.reason);
      if (snapshot.busy || snapshot.ownPending) {
        if (!waitForInitialIdle || Date.now() >= deadline)
          return pause("session-not-idle");
        r.reason = "waiting-for-session-idle";
        await delay(r.abort.signal);
        continue;
      }
      const [{ messages, truncated }, scope] = await Promise.all([
        api.history(r, r.abort.signal),
        api.scope(r, r.abort.signal),
      ]);
      if (!active(r)) return;
      if (!scope.ok) return pause(scope.reason);
      if (!Array.isArray(messages)) return pause("idle-boundary-unconfirmed");
      const tail = messages[0];
      if (messages.length && (typeof tail?.id !== "string" || !tail.id))
        return pause("idle-boundary-unconfirmed");
      if (expectedIdle !== undefined) {
        if (tail?.id !== expectedIdle) return pause("history-changed");
      } else if ((tail && tail.type !== "idle") || (!tail && truncated)) {
        if (Date.now() >= deadline) return pause("idle-boundary-unconfirmed");
        r.reason = "waiting-for-idle-boundary";
        await delay(r.abort.signal);
        continue;
      }

      // Close the snapshot/history gap as far as V2 permits. The API cannot
      // make this check and prompt admission atomic.
      const finalSnapshot = await api.snapshot(r, r.abort.signal);
      if (!active(r)) return;
      if (finalSnapshot.reason) return pause(finalSnapshot.reason);
      if (finalSnapshot.busy || finalSnapshot.ownPending) {
        if (!waitForInitialIdle || Date.now() >= deadline)
          return pause("session-not-idle");
        r.reason = "waiting-for-session-idle";
        await delay(r.abort.signal);
        continue;
      }

      const id = `msg_${randomUUID()}`;
      r.turn = { id, baseline: tail?.id ?? null, signature: scope.signature };
      r.turns++;
      r.reason = "admitting";
      // Once invoked, a timeout or stop cannot prove this hasn't been admitted.
      const receipt = await api.prompt(r, {
        id,
        sessionID: r.sessionID,
        delivery: "queue",
        text: promptText({ ...r, id }),
        skills: [{ id: "agent-loop" }],
      });
      if (!active(r)) return;
      if (receipt?.id !== id || receipt.sessionID !== r.sessionID)
        return pause("admission-uncertain");
      r.reason = "waiting-for-turn";
      return;
    }
  }
  async function drive(r) {
    try {
      const lease = await api.arm(r, r.abort.signal);
      if (lease.ok) r.token = lease.token;
      if (!active(r)) return;
      if (!lease.ok) return pause(lease.reason);
      await schedule(r);
      while (active(r)) {
        await delay(r.abort.signal);
        const snapshot = await api.snapshot(r, r.abort.signal);
        if (!active(r)) break;
        if (snapshot.reason) return pause(snapshot.reason);
        if (snapshot.busy || snapshot.ownPending) continue;
        const { messages, truncated } = await api.history(r, r.abort.signal);
        if (!active(r)) break;
        const outcome = reconcile(
          messages,
          r.turn.id,
          r.turn.baseline,
          truncated,
        );
        if (outcome.pending) continue;
        if (outcome.reason) return pause(outcome.reason);
        if (
          outcome.checkpoint === "complete" ||
          outcome.checkpoint === "blocked"
        )
          return pause(`agent-reported-${outcome.checkpoint}`);
        if (r.turns >= r.limit) return pause("turn-limit");
        const scope = await api.scope(r, r.abort.signal);
        if (!active(r)) break;
        if (!scope.ok) return pause(scope.reason);
        r.stalls =
          scope.signature === r.turn.signature ||
          r.signatures.has(scope.signature)
            ? r.stalls + 1
            : 0;
        r.signatures.add(scope.signature);
        r.signatures.add(r.turn.signature);
        if (r.stalls >= 2) return pause("no-progress");
        await schedule(r, outcome.idle);
      }
    } catch {
      if (active(r))
        pause(
          r.reason === "admitting"
            ? "admission-uncertain"
            : "reconciliation-error",
        );
    } finally {
      if (r.token) {
        try {
          await api.release(r);
        } catch {
          /* Lease expires. Never log details. */
        }
      }
      r.pending = false;
      delete r.ticket;
      delete r.todo;
    }
  }
  return {
    start({ sessionID, location, ticket, todo }) {
      if (closed) return { state: "off", reason: "controller-closed" };
      if (run?.pending)
        return run.sessionID === sessionID
          ? status(sessionID)
          : { state: "off", reason: "controller-in-use" };
      run = {
        sessionID,
        location,
        ticket,
        todo,
        limit: TURN_LIMIT,
        state: "active",
        reason: "checking-scope",
        turns: 0,
        stalls: 0,
        signatures: new Set(),
        pending: true,
        abort: new AbortController(),
        timer: setTimeout(() => pause("time-limit"), maxAge),
      };
      run.timer.unref?.();
      void drive(run);
      return status(sessionID);
    },
    status,
    stop(sessionID) {
      if (run?.sessionID === sessionID) pause("user-paused");
      return status(sessionID);
    },
    close() {
      pause("controller-closed");
      closed = true;
    },
    event({ type, data, location }) {
      const eventSession = data?.sessionID ?? data?.form?.sessionID;
      const locationForm = type === "form.created" && !eventSession && location;
      if (
        !run ||
        !active(run) ||
        (eventSession !== run.sessionID && !locationForm) ||
        (type !== "session.moved" &&
          location &&
          (location.directory !== run.location.directory ||
            (run.location.workspaceID !== undefined &&
              location.workspaceID !== run.location.workspaceID)))
      )
        return;
      // These are vetoes only. No live event, including success, advances the loop.
      if (SAFETY_EVENTS.has(type)) pause(SAFETY_EVENTS.get(type));
      if (type === "session.inbox.enqueued" && data.inboxID !== run.turn?.id)
        pause("other-input");
      if (type === "session.inbox.cancelled" && data.inboxID === run.turn?.id)
        pause("prompt-cancelled");
    },
  };
}
