import { Plugin } from "@opencode/plugin";
import { createLoop, vetoTypes } from "./loop.js";
import { control, id } from "./rpc.js";
import { createScope } from "./scope.js";
import { bounded, createServerAPI } from "./server-api.js";

export async function setup(
  ctx,
  { delay, startupIdleGrace = 5 * 60_000 } = {},
) {
  const api = createServerAPI(ctx);
  const scope = createScope({
    location: ctx.location,
    getSession: api.getSession,
    verify: api.verify,
  });
  const claim = ({ sessionID, ticket, todo }) => ({
    sessionID,
    ticket,
    todo,
  });
  const loop = createLoop({
    delay,
    startupIdleGrace,
    api: {
      ...api,
      arm: (r, signal) =>
        bounded((signal) => scope.arm(claim(r), signal), signal),
      scope: (r, signal) => bounded((signal) => scope.check(r, signal), signal),
      release: scope.release,
    },
  });
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
    start: async (input) => loop.start({ ...input, location: ctx.location }),
    status: async ({ sessionID }) => loop.status(sessionID),
    async stop({ sessionID }) {
      const status = loop.stop(sessionID);
      await scope.stop({ sessionID });
      return status;
    },
  });
  const events = new AbortController();
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
  return async () => {
    loop.close();
    scope.close();
    events.abort();
    await registration.dispose();
  };
}

export default Plugin.define({ id, setup });
