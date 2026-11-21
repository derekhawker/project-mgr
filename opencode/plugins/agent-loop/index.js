import { Plugin } from "@opencode/plugin";
import { setTimeout as sleep } from "node:timers/promises";
import { createJournal } from "./journal.js";
import { createLoop, vetoTypes } from "./loop.js";
import { control, id } from "./rpc.js";
import { createScope } from "./scope.js";
import { bounded, createServerAPI } from "./server-api.js";

export async function setup(
  ctx,
  { delay, now, admissionGrace, readLog, writeTimeout = 10_000, startupIdleGrace = 5 * 60_000 } = {},
) {
  const api = createServerAPI(ctx, undefined, readLog);
  const scope = createScope({
    location: ctx.location,
    getSession: api.getSession,
    verify: api.verify,
    now,
  });
  const claim = ({ sessionID, ticket, todo, deadline }) => ({
    sessionID,
    ticket,
    todo,
    deadline,
  });
  const journal = ctx.storage && createJournal(ctx.storage, ctx.location);
  const loop = createLoop({
    delay,
    now,
    journal,
    admissionGrace,
    writeTimeout,
    startupIdleGrace,
    api: {
      ...api,
      arm: (r, signal) =>
        bounded((signal) => scope.arm(claim(r), signal), signal),
      scope: (r, signal) => bounded((signal) => scope.check(r, signal), signal),
      release: scope.release,
    },
  });
  const events = new AbortController();
  let releaseLocation;
  let recoveryIssue = "checking-recovery-storage";
  let initialLoad;
  async function load() {
    if (!journal) return (recoveryIssue = "recovery-storage-unavailable");
    releaseLocation ??= journal.claimLocation();
    if (!releaseLocation) return (recoveryIssue = "waiting-for-location-lease");
    try {
      const { record, reason } = await bounded(() => journal.load(), events.signal);
      if (events.signal.aborted) return;
      recoveryIssue = reason;
      if (!reason) journal.confirmLoaded(record?.sessionID);
      loop.restore(record, ctx.location);
    } catch {
      recoveryIssue = "recovery-storage-unavailable";
    }
  }
  async function unavailable() {
    await initialLoad;
    if (recoveryIssue === "waiting-for-location-lease" && journal.isDraining())
      return { state: "paused", reason: "recovery-storage-write-pending" };
    return recoveryIssue && { state: "paused", reason: recoveryIssue };
  }
  async function committed(sessionID) {
    try {
      return await bounded(() => loop.committed(sessionID), events.signal, writeTimeout);
    } catch {
      return { state: "paused", reason: "recovery-storage-write-pending" };
    }
  }
  async function status(sessionID) {
    const blocked = await unavailable();
    if (blocked) return journal?.pendingPause(sessionID)
      ? { state: "paused", reason: "user-paused-not-saved" } : blocked;
    const current = loop.status(sessionID);
    if (current.state !== "off") return current;
    try {
      const saved = await bounded(() => journal.terminal(sessionID), events.signal);
      // A new start may have raced the archived-status read.
      const latest = loop.status(sessionID);
      return latest.state === "off" && saved ? saved : latest;
    } catch {
      return { state: "paused", reason: "recovery-storage-unavailable" };
    }
  }
  const registration = await ctx.rpc.register(control, {
    async discover({ sessionID }, request) {
      try {
        if (!(await scope.eligible(sessionID, request?.signal)))
          return { ok: false, reason: "session-not-eligible" };
        return await api.discover({ sessionID }, request?.signal);
      } catch {
        return { ok: false, reason: "scope-unavailable" };
      }
    },
    async start(input) {
      const blocked = await unavailable();
      if (blocked) return blocked;
      const started = loop.start({ ...input, location: ctx.location });
      return started.state === "active" ? committed(input.sessionID) : started;
    },
    status: ({ sessionID }) => status(sessionID),
    async stop({ sessionID }) {
      if (!journal) return { state: "paused", reason: "user-paused-not-saved" };
      // Record the veto before awaiting storage or another location owner.
      journal.requestStop(sessionID);
      const blocked = await unavailable();
      if (blocked) return { state: "paused", reason: "user-paused-not-saved" };
      await scope.stop({ sessionID });
      const stopped = await committed(sessionID);
      if (stopped.state === "off" || (stopped.state === "paused" && stopped.reason !== "user-paused" &&
          !stopped.reason.endsWith("-not-saved") && stopped.reason !== "recovery-storage-write-pending"))
        journal.clearPause(sessionID, "user-paused");
      return stopped.state === "off" ? status(sessionID) : stopped;
    },
  });
  const unsubscribeStop = journal?.onStop((sessionID) => loop.stop(sessionID));
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({
        types: vetoTypes,
        signal: events.signal,
      }))
        loop.event(event);
    } catch {
      // Durable reads independently gate each admission. Never log payloads.
    }
  })();
  initialLoad = load();
  void (async () => {
    try {
      await initialLoad;
      while (journal && ["recovery-storage-unavailable", "waiting-for-location-lease"].includes(recoveryIssue)) {
        await sleep(250, undefined, { signal: events.signal, ref: false });
        await load();
      }
    } catch { /* Cleanup aborts the watcher. */ }
  })();
  return async () => {
    events.abort();
    unsubscribeStop?.();
    const closed = loop.close();
    scope.close();
    // The host can finish cleanup without waiting indefinitely. Never unlock
    // the location on timeout: storage.set has no cancellation or CAS.
    const release = () => {
      const held = releaseLocation;
      if (!held) return;
      releaseLocation = undefined;
      journal.clearDraining();
      held();
    };
    if (releaseLocation) journal.markDraining();
    const drained = closed.then(release, release);
    try {
      await bounded(() => drained, undefined, writeTimeout);
    } catch { /* The underlying write and fence are still held. */ }
    await registration.dispose();
  };
}

export default Plugin.define({ id, setup });
