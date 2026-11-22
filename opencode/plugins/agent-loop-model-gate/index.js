import { Plugin } from "@opencode/plugin";
import { createModelGate } from "./engine.js";
import { createModelGateAPI } from "./api.js";

export const id = "project-mgr-agent-loop-model-gate";
const stopCommand = "agent-loop-model-gate-stop";

export async function setup(ctx) {
  if (!ctx.storage) throw new Error("Durable plugin storage is required");
  const controller = new AbortController();
  const engine = createModelGate({
    api: createModelGateAPI(ctx),
    storage: ctx.storage,
  });
  const registration = await ctx.command.transform((editor) => {
    editor.add({
      name: stopCommand,
      description: "Stop automatic ticket continuation for this session",
      execute: async ({ sessionID }) => engine.stop(sessionID),
    });
  });

  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({
        types: [
          "session.idle",
          "session.instructions.updated",
          "session.created",
          "session.unarchived",
        ],
        signal: controller.signal,
      })) {
        void engine.event(event).catch(() => {});
      }
    } catch {
      // Startup reconciliation and hard reads fail closed; never log event payloads.
    }
  })();
  void engine.scan().catch(() => {});

  return async () => {
    controller.abort();
    engine.close();
    await registration.dispose();
  };
}

export default Plugin.define({ id, setup });
