import { Plugin } from "@opencode/plugin";
import { configuredSessionAllowlist, createModelGate, wakeEventTypes } from "./engine.js";
import { createModelGateAPI } from "./api.js";
import { consumeEventStream } from "./event-stream.js";
import { eventOwnerSessionIDs, sessionIDFromEvent } from "./event-scope.js";
import { control } from "./rpc.js";

export const id = "project-mgr-agent-loop-model-gate";
const stopCommand = "agent-loop-model-gate-stop";

export async function setup(ctx) {
  const allowedSessionIDs = configuredSessionAllowlist(ctx.options);
  if (allowedSessionIDs.length === 0) return async () => {};
  if (!ctx.storage) throw new Error("Durable plugin storage is required");
  const controller = new AbortController();
  const engine = createModelGate({
    api: createModelGateAPI(ctx, { allowedSessionIDs }),
    storage: ctx.storage,
    allowedSessionIDs,
  });
  const rpc = await ctx.rpc.register(control, {
    async status({ sessionID }) {
      return engine.status(sessionID);
    },
  });
  const registration = await ctx.command.transform((editor) => {
    editor.add({
      name: stopCommand,
      description: "Stop automatic ticket continuation for this session",
      execute: async ({ sessionID }) => engine.stop(sessionID),
    });
  });

  void consumeEventStream({
    subscribe: ({ signal }) =>
      ctx.event.subscribe({
        types: wakeEventTypes,
        signal,
      }),
    onEvent: (event) => {
      const sessionID = sessionIDFromEvent(event);
      if (!allowedSessionIDs.includes(sessionID)) return;
      void eventOwnerSessionIDs(ctx, [sessionID])
        .then((owners) => {
          if (owners.has(sessionID)) return engine.event(event);
        })
        .catch(() => {});
    },
    onState: (state) => engine.setEventStreamState(state),
    signal: controller.signal,
  });
  return async () => {
    controller.abort();
    engine.close();
    await rpc.dispose();
    await registration.dispose();
  };
}

export default Plugin.define({ id, setup });
