import { Plugin } from "@opencode/plugin/tui";
import { control, id } from "./rpc.js";

export function setup(context) {
  let closed = false;
  let confirming = false;
  const rpc = ({ sessionID, location }, method, input) =>
    context.client
      .rpc(control)
      [method](
        { sessionID, ...input },
        { location, signal: AbortSignal.timeout(15_000) },
      );
  const target = () => {
    const route = context.ui.router.current();
    if (route.type !== "session") return;
    const location = context.data.session.get(route.sessionID)?.location;
    if (location?.directory) return { sessionID: route.sessionID, location };
  };
  const show = ({ state, reason, turns, limit }) => {
    if (!closed)
      context.ui.toast.show({
        message: `Agent loop ${state}: ${reason}${limit ? ` (${turns}/${limit} turns)` : ""}`,
      });
  };
  const commands = {
    async start(original) {
      if (confirming) return;
      confirming = true;
      try {
        const stillTargeting = () => {
          const current = target();
          return (
            current?.sessionID === original.sessionID &&
            current.location.directory === original.location.directory &&
            current.location.workspaceID === original.location.workspaceID
          );
        };
        const binding = await rpc(original, "discover");
        if (closed) return;
        if (!stillTargeting())
          return show({ state: "off", reason: "session-changed" });
        if (!binding.ok) return show({ state: "off", reason: binding.reason });
        const { ticket, todo } = binding;
        const confirmed = await context.ui.dialog.confirm({
          title: "Arm ticket agent loop?",
          message: `Session: ${original.sessionID}\nLocation: ${original.location.directory}\nTicket: ${ticket}\nTodo: ${todo}\nUp to 400 prompts or three hours. The server can continue after this terminal closes. This does not approve any human gate.`,
          label: { confirm: "Arm loop", cancel: "Cancel" },
        });
        if (!confirmed || closed) return;
        if (!stillTargeting())
          return show({ state: "off", reason: "session-changed" });
        show(await rpc(original, "start", { ticket, todo }));
      } finally {
        confirming = false;
      }
    },
    async status(t) {
      show(await rpc(t, "status"));
    },
    async stop(t) {
      show(await rpc(t, "stop"));
    },
  };
  context.keymap.layer(() => ({
    mode: "global",
    commands: Object.entries(commands).map(([action, run]) => ({
      id: `${id}.${action}`,
      title: `Agent loop: ${action}`,
      group: "Agent loop",
      palette: true,
      slash: { name: `agent-loop-${action}` },
      enabled: () => !closed && Boolean(target()),
      async run() {
        const t = target();
        if (!t || closed) return;
        try {
          await run(t);
        } catch {
          show({ state: "unknown", reason: "control-unavailable" });
        }
      },
    })),
  }));
  return () => {
    closed = true;
  };
}

export default Plugin.define({ id, setup });
