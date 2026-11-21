import { createLocalReader } from "./server-http.js";
import { discoverWorkspaceTicket, verifyWorkspaceTicket } from "./workspace.js";

const own = (object, key) => Object.hasOwn(object, key);
const data = (result) => (result && own(result, "data") ? result.data : result);
const HISTORY_PAGE_SIZE = 100;
const MAX_HISTORY_PAGES = 10;
const HISTORY_TIMEOUT_MS = 10_000;
const durableVetoes = new Map([
  ["session.execution.failed", "execution-failed"],
  ["session.moved", "session-moved"],
  ["session.archived", "session-archived"],
  ["session.deleted", "session-deleted"],
]);

// The Promise context supports RequestOptions, but also bound our wait if the
// implementation doesn't honor the signal. The runner decides when it is safe
// to issue an idempotent retry; this adapter never retries by itself.
export async function bounded(call, signal, ms = 10_000) {
  const timeout = AbortSignal.timeout(ms);
  const request = signal ? AbortSignal.any([signal, timeout]) : timeout;
  request.throwIfAborted();
  let abort;
  try {
    return await Promise.race([
      new Promise((_, reject) => {
        abort = () => reject(request.reason);
        request.addEventListener("abort", abort, { once: true });
      }),
      call(request),
    ]);
  } finally {
    request.removeEventListener("abort", abort);
  }
}

export function createServerAPI(ctx, read = createLocalReader(ctx.location), readLog = read.events) {
  const session = (r) => ({ sessionID: r.sessionID });
  const sessionPath = (r) => `session/${encodeURIComponent(r.sessionID)}`;
  const path = (r) => `/api/${sessionPath(r)}`;
  const listEntries = (r, signal) => async () =>
    data(
      await bounded(
        (signal) =>
          ctx.session.instructions?.entry?.list
            ? ctx.session.instructions.entry.list(session(r), { signal })
            : read(
                `/api/experimental/${sessionPath(r)}/instructions/entries`,
                signal,
              ),
        signal,
      ),
    );
  async function getSession(sessionID, signal) {
    try {
      return data(await bounded((signal) => ctx.session.get({ sessionID }, { signal }), signal));
    } catch (error) {
      if (error?.status === 404 || error?._tag === "SessionNotFoundError") return;
      throw error;
    }
  }
  const page = (r, query, signal) =>
    bounded(
      (signal) =>
        ctx.message?.list
          ? ctx.message.list({ ...session(r), ...query }, { signal })
          : read(`${path(r)}/message?${new URLSearchParams(query)}`, signal),
      signal,
    );
  const checkPage = (page) => {
    const next = page?.cursor?.next;
    if (
      !Array.isArray(page?.data) ||
      (next !== null && (typeof next !== "string" || !next))
    )
      throw new Error("history unavailable");
    return page;
  };
  return {
    getSession,
    discover: (r, signal) =>
      discoverWorkspaceTicket(listEntries(r, signal), r.sessionID),
    verify: (r, signal) =>
      verifyWorkspaceTicket(listEntries(r, signal), r.sessionID, r.ticket),
    // A user stop prevents future admissions; it doesn't cancel an already
    // issued prompt. Keep the runner occupied until this bounded call settles.
    prompt: async (_r, input) =>
      data(await bounded((signal) => ctx.session.prompt(input, { signal }))),
    async retryEvidence(r, signal) {
      return bounded(async (signal) => {
        const after = r.turn ? r.turn.logAfter : r.initialLogAfter;
        const query = new URLSearchParams({ follow: "false" });
        if (Number.isSafeInteger(after)) query.set("after", String(after));
        let delivered = false;
        let enqueued = false;
        let shutdowns = 0;
        let lastShutdownSeq;
        let resumed = false;
        let last = after ?? null;
        for await (const event of readLog(`/api/experimental/${sessionPath(r)}/log?${query}`, signal)) {
          if (event?.type === "log.synced" && event.aggregateID === r.sessionID) {
            const cursor = event.seq ?? null;
            if (cursor === last) return { delivered, cursor, ...(enqueued && { enqueued }), ...(shutdowns && { shutdowns, resumed, lastShutdownSeq }) };
            break;
          }
          const seq = event?.durable?.seq;
          if (!event?.type || event.durable?.aggregateID !== r.sessionID ||
              !Number.isSafeInteger(seq) || seq < 0 || (last !== null && seq <= last))
            break;
          last = seq;
          if (after === undefined) continue; // Capture a baseline, not vetoes from prior work.
          if (durableVetoes.has(event.type)) return { reason: durableVetoes.get(event.type) };
          if (event.type === "session.execution.interrupted") {
            if (event.data?.reason !== "shutdown") return { reason: "execution-interrupted" };
            shutdowns++;
            lastShutdownSeq = seq;
            resumed = false;
          }
          if (event.type === "session.execution.started" && shutdowns) resumed = true;
          if (event.type === "session.inbox.enqueued" && event.data?.inboxID !== r.turn?.id)
            return { reason: "other-input" };
          if (!r.turn) continue;
          if (event.data?.inboxID !== r.turn.id) continue;
          if (event.type === "session.inbox.enqueued") enqueued = true;
          if (event.type === "session.inbox.cancelled") return { reason: "prompt-cancelled" };
          if (event.type === "session.inbox.delivered") delivered = true;
        }
        return { reason: "recovery-log-unavailable" };
      }, signal);
    },
    async snapshot(r, signal) {
      const args = session(r);
      const [s, inbox, permissions, forms, locationForms] = await Promise.all([
        getSession(r.sessionID, signal),
        bounded(
          (signal) =>
            ctx.session.inbox?.list
              ? ctx.session.inbox.list(args, { signal })
              : read(`${path(r)}/inbox`, signal),
          signal,
        ).then(data),
        bounded((signal) => ctx.permission.list(args, { signal }), signal).then(
          data,
        ),
        bounded(
          (signal) =>
            ctx.session.form?.list
              ? ctx.session.form.list(args, { signal })
              : read(`${path(r)}/form`, signal),
          signal,
        ).then(data),
        bounded(
          (signal) =>
            ctx.form?.list
              ? ctx.form.list({ location: ctx.location }, { signal })
              : read("/api/form", signal),
          signal,
        ).then(data),
      ]);
      if (
        s?.id !== r.sessionID ||
        s.parentID ||
        s.time?.archived !== undefined ||
        s.location?.directory !== ctx.location.directory ||
        s.location?.workspaceID !== ctx.location.workspaceID ||
        s.projectID !== ctx.location.project.id
      )
        return { reason: "session-not-eligible" };
      if (
        ![inbox, permissions, forms, locationForms].every(Array.isArray) ||
        !inbox.every((item) => typeof item?.id === "string")
      )
        return { reason: "pending-status-unavailable" };
      if (permissions.length) return { reason: "permission-requested" };
      if (forms.length || locationForms.length)
        return { reason: "form-requested" };
      if (inbox.some((item) => item.id !== r.turn?.id))
        return { reason: "other-input-pending" };
      // Sample activity last so a slow gate read cannot hide a known busy session.
      const active = await bounded(
        (signal) =>
          ctx.session.active
            ? ctx.session.active({ signal })
            : read("/api/session/active", signal),
        signal,
      ).then(data);
      if (
        !active ||
        typeof active !== "object" ||
        Array.isArray(active) ||
        !Object.entries(active).every(
          ([id, status]) => id.startsWith("ses") && status?.type === "running",
        )
      )
        return { reason: "activity-status-unavailable" };
      return {
        busy: own(active, r.sessionID), ownPending: inbox.length > 0,
        ...(s.outcome && { outcome: s.outcome }),
      };
    },
    async history(r, signal) {
      const historySignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(HISTORY_TIMEOUT_MS)])
        : AbortSignal.timeout(HISTORY_TIMEOUT_MS);
      const messages = [];
      let cursor;
      let pages = 0;
      do {
        const query = cursor
          ? { cursor, limit: HISTORY_PAGE_SIZE }
          : { order: "desc", limit: HISTORY_PAGE_SIZE };
        const current = checkPage(await page(r, query, historySignal));
        messages.push(...current.data);
        cursor = current.cursor.next;
        pages++;
        // When no message follows the exact reservation boundary, older
        // pages cannot contain evidence of work for this reserved turn.
        if (pages === 1 && r.turn && messages[0]?.id === r.turn.baseline)
          return { messages, truncated: false };

        // Long turns can push their admitted prompt outside the newest page.
        // Continue only until the prompt and its immediate older boundary are
        // present; never scan an unbounded session transcript.
        const promptIndex = r.turn
          ? messages.findIndex((message) => message?.id === r.turn.id)
          : -1;
        const boundaryPresent =
          promptIndex >= 0 && promptIndex + 1 < messages.length;
        if (!r.turn || boundaryPresent || !cursor || pages >= MAX_HISTORY_PAGES)
          return {
            messages,
            truncated:
              Boolean(cursor) &&
              (pages >= MAX_HISTORY_PAGES || messages.length === 0),
          };
      } while (cursor);
      return { messages, truncated: false };
    },
  };
}
