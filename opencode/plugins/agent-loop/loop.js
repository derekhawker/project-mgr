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
export function reconcile(messages, id, baseline, truncated, evidence = {}) {
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
  let work = messages.slice(0, index);
  const interruptions = work.filter((message) => message?.type === "idle" && message.outcome === "interrupted");
  if (interruptions.length) {
    if (interruptions.length > (evidence.shutdowns ?? 0)) {
      if (work[0]?.type === "idle" && work[0].outcome === "interrupted")
        return { reason: "execution-not-successful" };
      return { pending: true, interruptionPending: true };
    }
    if (!evidence.resumed)
      return { pending: true, interruptionPending: true };
    work = work.filter((message) => !interruptions.includes(message));
  }
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
  return `Continue the approved ticket using @agent-loop. Reread the authoritative ticket ${JSON.stringify(ticket)} and TODO ${JSON.stringify(todo)}, including after compaction. The ticket defines outcomes and acceptance; the TODO is a short queue of open work. After each item, continue with the next ready approved item. If the queue is empty while ticket outcomes remain open, rebuild it from those gaps and continue. An empty queue means complete only when all ticket outcomes meet acceptance. Group connected steps into useful user journeys; replace finished actions with next actions, and keep evidence in tests/artifacts rather than TODO history. Leave permissions, forms, destructive actions, user-data cutover, and closeout to the user; arming is not approval for them. Report concrete work and checks briefly, then end with “Agent loop checkpoint: ${id} ready”, using blocked only when a decision, permission, access, or missing record prevents progress, or complete when all ticket outcomes meet acceptance.`;
}

export function createLoop({
  api,
  delay = (signal) => sleep(2000, undefined, { signal }),
  journal,
  now = Date.now,
  maxAge = MAX_AGE,
  startupIdleGrace = 0,
  admissionGrace = 15_000,
  writeTimeout = 10_000,
}) {
  let run;
  let retained;
  let closed = false;
  const active = (r) => run === r && r.state === "active" && !closed;
  const expired = (r) => now() >= r.deadline;

  function save(r) {
    if (!journal) return;
    // Snapshot at the call site. A veto while a write is outstanding must
    // queue a terminal record after it, never race or overwrite that veto.
    const value = { ...r, signatures: [...r.signatures] };
    return enqueueWrite(r, () => journal.save(value));
  }
  function enqueueWrite(r, writeOperation) {
    const write = r.write.catch(() => {}).then(writeOperation);
    r.write = write;
    const timer = setTimeout(() => { r.writeSlow = true; }, writeTimeout);
    timer.unref?.();
    const settled = () => {
      clearTimeout(timer);
      if (r.write === write) r.writeSlow = false;
    };
    void write.then(settled, settled);
    return write;
  }
  function pause(reason) {
    const r = run;
    if (!r || !active(r)) return;
    r.state = "paused";
    r.reason = reason;
    clearTimeout(r.timer);
    r.abort.abort();
    if (r.journaled) saveTerminal(r);
  }
  function saveTerminal(r) {
    if (r.terminalPending) return r.terminalWrite;
    const { reason } = r;
    journal.rememberPause(r.sessionID, reason);
    r.terminalPending = true;
    r.terminalWrite = save(r).then(() => {
      r.unsaved = false;
      journal.clearPause(r.sessionID, reason);
    }, () => {
      r.unsaved = true;
    }).finally(() => { r.terminalPending = false; });
    return r.terminalWrite;
  }
  function live(r) {
    if (active(r)) {
      if (expired(r)) pause("time-limit");
      else if (now() < r.started) pause("clock-before-run-start");
    }
    return active(r);
  }
  function status(sessionID) {
    if (closed) return { state: "off", reason: "controller-closed" };
    const match = run?.sessionID === sessionID ? run : retained;
    return match?.sessionID === sessionID
      ? {
          state: match.state,
          reason: match.writeSlow ? "recovery-storage-write-pending"
            : match.terminalPending ? `${match.reason}-not-saved`
            : match.unsaved ? `${match.reason}-not-saved` : match.reason,
          turns: match.turns,
          limit: match.limit,
        }
      : { state: "off", reason: "not-armed" };
  }
  const retryReasons = new Set([
    "workspace-ticket-entry-unavailable",
    "pending-status-unavailable",
    "activity-status-unavailable",
    "recovery-log-unavailable",
  ]);
  function waitForResume(r) {
    r.recovering = true;
    r.shutdownObserved = true;
    r.reason = "waiting-for-server-resume";
  }
  const hasResumed = (r, evidence) => evidence?.resumed &&
    (r.shutdownSeq === undefined || evidence.lastShutdownSeq >= r.shutdownSeq);
  async function read(r, call) {
    while (live(r)) {
      try {
        const result = await call();
        if (!r.recovering || !retryReasons.has(result?.reason)) return result;
        if (live(r)) r.reason = result.reason;
      } catch (error) {
        if (!r.recovering) throw error;
        if (live(r)) r.reason = "recovery-read-unavailable";
      }
      if (live(r)) await delay(r.abort.signal);
    }
  }
  async function schedule(r, expectedIdle, verifiedShutdownSeq) {
    const waitForInitialIdle = expectedIdle === undefined;
    const deadline = r.initialDeadline;
    const tailHistory = () => api.history({ sessionID: r.sessionID }, r.abort.signal);
    while (live(r)) {
      const shutdownEpoch = r.shutdownEpoch;
      const snapshot = await read(r, () => api.snapshot(r, r.abort.signal));
      if (!live(r)) return;
      if (snapshot.reason) return pause(snapshot.reason);
      if (snapshot.busy || snapshot.ownPending) {
        if (!waitForInitialIdle || now() >= deadline)
          return pause("session-not-idle");
        r.reason = "waiting-for-session-idle";
        await delay(r.abort.signal);
        continue;
      }
      const result = await read(r, async () => {
        const scope = await api.scope(r, r.abort.signal);
        if (!scope.ok) return scope;
        const evidence = journal && await replay(r);
        if (evidence?.reason) return evidence;
        return { history: await tailHistory(), scope, evidence };
      });
      if (!live(r)) return;
      if (!result.history) return pause(result.reason);
      if (!waitForInitialIdle && result.evidence?.lastShutdownSeq !== verifiedShutdownSeq) {
        // Keep the old ID and replay boundary until its completion has been
        // reconciled against this newer shutdown evidence.
        waitForResume(r);
        return;
      }
      const { history: { messages, truncated }, scope } = result;
      if (!Array.isArray(messages)) return pause("idle-boundary-unconfirmed");
      const tail = messages[0];
      if (waitForInitialIdle && (result.evidence?.shutdowns || r.shutdownObserved) &&
           !(tail?.type === "idle" && tail.outcome === "succeeded" && hasResumed(r, result.evidence))) {
        r.reason = "waiting-for-server-resume";
        await delay(r.abort.signal);
        continue;
      }
      if (messages.length && (typeof tail?.id !== "string" || !tail.id))
        return pause("idle-boundary-unconfirmed");
      if (expectedIdle !== undefined) {
        if (tail?.id !== expectedIdle) return pause("history-changed");
      } else if ((tail && tail.type !== "idle") || (!tail && truncated)) {
        if (now() >= deadline) return pause("idle-boundary-unconfirmed");
        r.reason = "waiting-for-idle-boundary";
        await delay(r.abort.signal);
        continue;
      }
      if (r.recovering && waitForInitialIdle && tail && tail.outcome !== "succeeded")
        return pause("execution-not-successful");

      // Close the snapshot/history gap as far as V2 permits. The API cannot
      // make this check and prompt admission atomic.
      const finalSnapshot = await api.snapshot(r, r.abort.signal).catch((error) => {
        if (!r.recovering) throw error;
        return { reason: "recovery-read-unavailable" };
      });
      if (!live(r)) return;
      if (r.recovering && (retryReasons.has(finalSnapshot.reason) ||
          finalSnapshot.reason === "recovery-read-unavailable")) {
        r.reason = finalSnapshot.reason;
        await delay(r.abort.signal);
        continue;
      }
      if (finalSnapshot.reason) return pause(finalSnapshot.reason);
      // Do not replace the prior turn using evidence that predates a shutdown
      // observed during these awaits. Reconcile that turn again instead.
      if (shutdownEpoch !== r.shutdownEpoch || (!waitForInitialIdle && r.shutdownObserved)) {
        if (!waitForInitialIdle) return;
        await delay(r.abort.signal);
        continue;
      }
      if (finalSnapshot.busy || finalSnapshot.ownPending) {
        if (!waitForInitialIdle || now() >= deadline)
          return pause("session-not-idle");
        r.reason = "waiting-for-session-idle";
        await delay(r.abort.signal);
        continue;
      }

      const id = `msg_${randomUUID()}`;
      r.shutdownObserved = false;
      r.shutdownSeq = undefined;
      r.turn = {
        id, baseline: tail?.id ?? null, signature: scope.signature,
        logAfter: result.evidence?.cursor, attempted: false, previousID: r.turn?.id,
      };
      r.turns++;
      // Write ahead of admission, including the count and exact prompt ID.
      // A crash before the call is indistinguishable from a lost receipt.
      if (journal) r.reason = "checking-reserved-prompt";
      if (journal && !(await persist(r))) return;
      if (!live(r)) return;
      if (journal) {
        // The write can take time. Recheck the same boundary, scope and gates
        // before crossing from write-ahead reservation to actual admission.
        const gate = await read(r, async () => {
          const [verified, latest] = await Promise.all([
            api.scope(r, r.abort.signal),
            tailHistory(),
          ]);
          if (!verified.ok) return verified;
          if (verified.signature !== r.turn.signature)
            return { reason: "todo-changed-before-admission" };
          if (
            !Array.isArray(latest.messages) ||
            (latest.messages[0]?.id ?? null) !== r.turn.baseline ||
            (!latest.messages.length && latest.truncated)
          ) return { reason: "history-changed" };
          const evidence = await replay(r);
          if (evidence.reason) return evidence;
          if (evidence.shutdowns || r.shutdownObserved) return { waitingForResume: true };
          return api.snapshot(r, r.abort.signal);
        });
        if (!live(r)) return;
        if (gate.reason) return pause(gate.reason);
        if (gate.waitingForResume || r.shutdownObserved) {
          waitForResume(r);
          return;
        }
        if (gate.busy || gate.ownPending) return pause("session-not-idle");
      }
      await submit(r);
      return;
    }
  }
  async function submit(r) {
    if (!live(r)) return;
    if (journal && r.turn.attempted === false && !r.shutdownObserved) {
      // Record possible admission before invoking the API. If a live shutdown
      // arrives during the write, restore the known-unsubmitted phase.
      r.turn = { ...r.turn, attempted: true };
      if (!(await persist(r)) || !live(r)) return;
      const gate = await read(r, async () => {
        const scope = await api.scope(r, r.abort.signal);
        if (!scope.ok) return scope;
        if (scope.signature !== r.turn.signature) return { reason: "todo-changed-before-admission" };
        const evidence = await replay(r);
        if (evidence.reason) return evidence;
        if (evidence.shutdowns) waitForResume(r);
        if (!r.shutdownObserved) {
          const { messages, truncated } = await api.history({ sessionID: r.sessionID }, r.abort.signal);
          if (!Array.isArray(messages) || (messages[0]?.id ?? null) !== r.turn.baseline ||
              (!messages.length && truncated)) return { reason: "history-changed" };
        }
        return api.snapshot(r, r.abort.signal);
      });
      if (!live(r)) return;
      if (gate.reason) return pause(gate.reason);
      if (r.shutdownObserved) {
        r.turn = { ...r.turn, attempted: false };
        await persist(r);
        return;
      }
      if (gate.busy || gate.ownPending) return pause("session-not-idle");
    }
    // Both admission paths converge here. There must be no await between
    // this veto check and calling prompt.
    if (r.shutdownObserved) return waitForResume(r);
    const { id } = r.turn;
    r.reason = "admitting";
    let receipt;
    try {
      receipt = await api.prompt(r, {
        id, sessionID: r.sessionID, delivery: "queue",
        text: promptText({ ...r, id }), skills: [{ id: "agent-loop" }],
      });
    } catch { /* An absent receipt says nothing about durable admission. */ }
    if (!live(r)) return;
    if (r.shutdownObserved) return waitForResume(r);
    if (receipt?.id !== id || receipt.sessionID !== r.sessionID) {
      r.recovering = true;
      r.reason = "admission-uncertain";
    } else {
      r.reason = "waiting-for-turn";
    }
  }
  const replay = (r) => (r.turn ? r.turn.logAfter : r.initialLogAfter) === undefined
    ? { reason: "recovery-log-boundary-missing" }
    : api.retryEvidence(r, r.abort.signal);

  async function retryReserved(r) {
    const shutdownEpoch = r.shutdownEpoch;
    const check = await read(r, async () => {
      const before = await api.snapshot(r, r.abort.signal);
      if (before.reason || before.busy) return before;
      const evidence = await replay(r);
      if (evidence.reason) return evidence;
      const recoveringShutdown = evidence.shutdowns || r.shutdownObserved;
      const mayHaveBeenAdmitted = r.turn.attempted !== false || before.ownPending ||
        evidence.enqueued || evidence.delivered;
      if (recoveringShutdown &&
          (mayHaveBeenAdmitted || (r.turn.attempted !== false && !hasResumed(r, evidence))))
        return { waitingForResume: true };
      const scope = await api.scope(r, r.abort.signal);
      if (!scope.ok) return scope;
      const history = await api.history(r, r.abort.signal);
      const outcome = reconcile(history.messages, r.turn.id, r.turn.baseline, history.truncated);
      if (outcome.reason !== "own-prompt-not-in-history") return { recheck: true };
      const exactBoundary = (history.messages[0]?.id ?? null) === r.turn.baseline;
      const resumedUnsentBoundary = recoveringShutdown && r.turn.attempted === false &&
        history.messages[0]?.type === "idle" && history.messages[0]?.outcome === "succeeded";
      if (history.truncated || (!exactBoundary && !resumedUnsentBoundary))
        return { reason: "turn-boundary-ambiguous" };
      if (recoveringShutdown && r.turn.baseline !== null &&
          (history.messages[0]?.type !== "idle" || history.messages[0]?.outcome !== "succeeded"))
        return { reason: "turn-boundary-ambiguous" };
      if (recoveringShutdown && r.turn.previousID) {
        const prior = await api.history({ sessionID: r.sessionID, turn: { id: r.turn.previousID } }, r.abort.signal);
        const idx = prior.messages?.findIndex((message) => message.id === r.turn.previousID);
        if (!(idx > 0) || prior.messages[idx].type !== "user" ||
            (!resumedUnsentBoundary && prior.messages[0].id !== r.turn.baseline) ||
            prior.messages[0].type !== "idle" || prior.messages[0].outcome !== "succeeded" ||
            prior.messages.slice(1, idx).some((message) => message.type === "user"))
          return { reason: "turn-boundary-ambiguous" };
      }
      // Delivery is already certain. Wait for the history projection rather
      // than retry a prompt that was demonstrably delivered.
      if (evidence.delivered) return { recheck: true };
      if (scope.signature !== r.turn.signature)
        return { reason: "todo-changed-before-admission" };
      return { ...await api.snapshot(r, r.abort.signal),
        ...(recoveringShutdown && {
          resumedCursor: evidence.cursor,
          ...(resumedUnsentBoundary && { resumedBaseline: history.messages[0].id }),
        }) };
    });
    if (!live(r)) return;
    if (check.reason) return pause(check.reason);
    if (check.waitingForResume) {
      waitForResume(r);
      return;
    }
    if (check.recheck || check.busy) return;
    if (check.resumedCursor !== undefined) {
      if (shutdownEpoch !== r.shutdownEpoch || check.ownPending) return;
      r.turn = {
        ...r.turn,
        logAfter: check.resumedCursor,
        ...(check.resumedBaseline && { baseline: check.resumedBaseline }),
      };
      r.shutdownObserved = false;
      r.shutdownSeq = undefined;
      // submit's write persists the resolved cursor with attempted=true.
    }
    // OpenCode deduplicates pending/delivered IDs. This is the original
    // journaled reservation, not another turn or another budget charge.
    await submit(r);
    if (live(r) && check.ownPending && !r.shutdownObserved) r.reason = "pending-prompt-not-running";
  }
  async function persist(r) {
    try {
      await save(r);
      return true;
    } catch {
      if (live(r)) pause("recovery-storage-write-failed");
      return false;
    }
  }
  async function drive(r) {
    try {
      const pendingPause = journal?.pendingPause(r.sessionID);
      if (pendingPause) return pause(pendingPause);
      if (journal) {
        while (live(r) && !(r.releaseSession = journal.claimSession(r.sessionID))) {
          if (!r.recovering) return pause("session-lease-in-use");
          r.reason = "waiting-for-session-lease";
          await delay(r.abort.signal);
        }
      }
      const lease = await read(r, () => api.arm(r, r.abort.signal));
      if (lease?.ok) r.token = lease.token;
      if (!live(r)) return;
      if (!lease.ok) return pause(lease.reason);
      if (journal && r.turn?.logAfter === undefined && r.turn)
        return pause("recovery-log-boundary-missing");
      if (journal && !r.journaled) {
        const evidence = await read(r, () => api.retryEvidence({ sessionID: r.sessionID }, r.abort.signal));
        if (!live(r)) return;
        if (evidence.reason) return pause(evidence.reason);
        r.initialLogAfter = evidence.cursor;
        if (retained && retained.sessionID !== r.sessionID) {
          try {
            await enqueueWrite(r, () => journal.archive(retained));
          } catch {
            return pause("recovery-storage-write-failed");
          }
        }
        if (!live(r)) return;
        r.journaled = true;
        if (!(await persist(r))) return;
        retained = r;
      }
      r.initialized.resolve();
      if (!r.turn) await schedule(r);
      let missingSince;
      let pendingRetried = false;
      let scoredTurn;
      let interruptedSince;
      while (live(r)) {
        if (!r.recovering || !r.firstPoll) await delay(r.abort.signal);
        r.firstPoll = false;
        const shutdownEpoch = r.shutdownEpoch;
        const snapshot = await read(r, () => api.snapshot(r, r.abort.signal));
        if (!live(r)) break;
        if (snapshot.reason) return pause(snapshot.reason);
        if (snapshot.busy) {
          r.reason = r.shutdownObserved ? "waiting-for-server-resume" : "waiting-for-turn";
          missingSince = undefined;
          pendingRetried = false;
          continue;
        }
        if (snapshot.ownPending) {
          if (r.recovering && journal) {
            r.reason = r.shutdownObserved ? "waiting-for-server-resume"
              : pendingRetried ? "pending-prompt-not-running" : "waiting-for-pending-prompt";
            missingSince ??= now();
            if (now() - missingSince >= admissionGrace) {
              await retryReserved(r);
              pendingRetried = true;
              missingSince = undefined;
            }
          } else {
            r.reason = "waiting-for-pending-prompt";
          }
          continue;
        }
        const history = await read(r, () => api.history(r, r.abort.signal));
        if (!live(r)) break;
        const { messages, truncated } = history;
        const evidence = r.recovering && journal ? await read(r, () => replay(r)) : {};
        if (!live(r)) break;
        if (evidence.reason) return pause(evidence.reason);
        const outcome = reconcile(
          messages,
          r.turn.id,
          r.turn.baseline,
          truncated,
          evidence,
        );
        if (outcome.reason === "own-prompt-not-in-history" && journal) {
          if (evidence.shutdowns || r.shutdownObserved) {
            r.reason = "waiting-for-server-resume";
            if (r.turn.attempted === false) await retryReserved(r);
            continue;
          }
          if (truncated || (messages[0]?.id ?? null) !== r.turn.baseline)
            return pause("turn-boundary-ambiguous");
          r.reason = "admission-uncertain";
          r.recovering = true;
          missingSince ??= now();
          if (now() - missingSince >= admissionGrace) {
            await retryReserved(r);
            missingSince = undefined;
          }
          continue;
        }
        // The history/status projection can expose an interruption before the
        // event log exposes its cause. Never infer a user stop from that gap.
        const interrupted = outcome.interruptionPending ||
          (outcome.reason === "execution-not-successful" && messages[0]?.outcome === "interrupted") ||
          (outcome.pending && snapshot.outcome === "interrupted");
        if (journal && (interrupted || interruptedSince !== undefined) && !evidence.shutdowns) {
          r.recovering = true;
          r.reason = "waiting-for-interruption-evidence";
          interruptedSince ??= now();
          if (now() - interruptedSince >= admissionGrace && !r.shutdownObserved)
            return pause(interrupted && outcome.pending ? "execution-interrupted" : "execution-not-successful");
          continue;
        }
        if (outcome.pending) {
          if (evidence.shutdowns || r.shutdownObserved) {
            r.reason = "waiting-for-server-resume";
            continue;
          }
          if (snapshot.outcome === "failed" || snapshot.outcome === "interrupted")
            return pause(`execution-${snapshot.outcome}`);
          r.reason = "waiting-for-durable-idle";
          continue;
        }
        if (outcome.reason) return pause(outcome.reason);
        if (shutdownEpoch !== r.shutdownEpoch || ((r.shutdownObserved || evidence.shutdowns) && !hasResumed(r, evidence))) {
          waitForResume(r);
          continue;
        }
        if (
          outcome.checkpoint === "complete" ||
          outcome.checkpoint === "blocked"
        )
          return pause(`agent-reported-${outcome.checkpoint}`);
        if (r.turns >= r.limit) return pause("turn-limit");
        const scope = await read(r, () => api.scope(r, r.abort.signal));
        if (!live(r)) break;
        if (!scope.ok) return pause(scope.reason);
        if (shutdownEpoch !== r.shutdownEpoch) continue;
        r.shutdownObserved = false;
        if (scoredTurn !== r.turn.id) {
          scoredTurn = r.turn.id;
          r.stalls = scope.signature === r.turn.signature || r.signatures.has(scope.signature)
            ? r.stalls + 1 : 0;
          r.signatures.add(scope.signature);
          r.signatures.add(r.turn.signature);
        }
        if (r.stalls >= 2) return pause("no-progress");
        await schedule(r, outcome.idle, evidence.lastShutdownSeq);
        if (scoredTurn !== r.turn.id) interruptedSince = undefined;
        missingSince = undefined;
      }
    } catch {
      if (active(r)) pause("reconciliation-error");
    } finally {
      if (r.token) {
        try {
          await api.release(r);
        } catch {
          /* Lease expires. Never log details. */
        }
      }
      await r.terminalWrite;
      if (!r.journaled && !retained?.unsaved && r.state === "paused" && r.reason === "user-paused")
        journal?.clearPause(r.sessionID, r.reason);
      r.releaseSession?.();
      r.pending = false;
      r.initialized.resolve();
    }
  }
  function launch(r) {
    run = r;
    r.pending = true;
    r.abort = new AbortController();
    r.initialized = Promise.withResolvers();
    r.write = Promise.resolve();
    r.timer = setTimeout(() => pause("time-limit"), Math.max(0, r.deadline - now()));
    r.timer.unref?.();
    void drive(r);
  }
  return {
    start({ sessionID, location, ticket, todo }) {
      if (closed) return { state: "off", reason: "controller-closed" };
      if (run?.pending || run?.unsaved)
        return run.sessionID === sessionID
          ? status(sessionID)
          : { state: "off", reason: "controller-in-use" };
      const started = now();
      launch({
        sessionID,
        location,
        ticket,
        todo,
        runID: randomUUID(),
        started,
        deadline: started + maxAge,
        initialDeadline: started + Math.min(startupIdleGrace, maxAge),
        limit: TURN_LIMIT,
        state: "active",
        reason: "checking-scope",
        turns: 0,
        stalls: 0,
        signatures: new Set(),
      });
      return status(sessionID);
    },
    restore(record, location) {
      if (!record || run || closed) return;
      const { phase, runID, sessionID, ticket, todo, started, deadline,
        initialDeadline, initialLogAfter, limit, turns, stalls, turn, reason, signatures } = record;
      const r = {
        runID, sessionID, ticket, todo, started, deadline, initialDeadline, initialLogAfter,
        limit, turns, stalls, reason, location, turn: turn ?? undefined,
        signatures: new Set(signatures), journaled: true,
        recovering: true, firstPoll: true,
      };
      if (phase === "terminal") {
        run = { ...r, state: "paused" };
        journal.clearPause(sessionID, journal.pendingPause(sessionID));
      }
      else launch({ ...r, state: "active", reason: "recovering" });
      retained = run;
    },
    async committed(sessionID) {
      const r = run;
      if (r?.sessionID === sessionID) {
        await r.initialized?.promise;
        await r.terminalWrite;
        if (r.state === "paused" && !r.unsaved)
          journal?.clearPause(sessionID, "user-paused");
      }
      return status(sessionID);
    },
    status,
    stop(sessionID) {
      if (!closed && run?.sessionID === sessionID) {
        if (run.state === "paused" && run.unsaved) saveTerminal(run);
        else pause("user-paused");
      }
      return status(sessionID);
    },
    async close() {
      closed = true;
      clearTimeout(run?.timer);
      run?.abort?.abort();
      run?.initialized?.resolve();
      await run?.write?.catch(() => {});
      // A transient storage failure during a stop/veto must not silently
      // turn into an armed run when the next instance reads the old record.
      await run?.terminalWrite;
      if (run?.unsaved) await saveTerminal(run);
      run?.releaseSession?.();
    },
    event({ type, data, durable, location }) {
      const eventSession = data?.sessionID ?? data?.form?.sessionID;
      const locationForm = type === "form.created" && !eventSession && location;
      if (
        !run ||
        !active(run) ||
        (eventSession !== run.sessionID && !locationForm) ||
        (type !== "session.moved" &&
          location &&
          (location.directory !== run.location.directory ||
            location.workspaceID !== run.location.workspaceID))
      )
        return;
      // These are vetoes only. No live event, including success, advances the loop.
      if (type === "session.execution.interrupted" && data?.reason === "shutdown") {
        run.shutdownEpoch = (run.shutdownEpoch ?? 0) + 1;
        if (durable?.aggregateID === run.sessionID && Number.isSafeInteger(durable.seq))
          run.shutdownSeq = Math.max(run.shutdownSeq ?? 0, durable.seq);
        waitForResume(run);
        return;
      }
      if (SAFETY_EVENTS.has(type)) pause(SAFETY_EVENTS.get(type));
      if (type === "session.inbox.enqueued" && data.inboxID !== run.turn?.id)
        pause("other-input");
      if (type === "session.inbox.cancelled" && data.inboxID === run.turn?.id)
        pause("prompt-cancelled");
    },
  };
}
