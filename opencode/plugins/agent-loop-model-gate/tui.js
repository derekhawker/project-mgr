import { Plugin } from "@opencode/plugin/tui";
import { control, id } from "./rpc.js";

const commandName = "agent-loop-model-gate-status";

export function setup(context) {
  let closed = false;
  const target = () => {
    const route = context.ui.router.current();
    if (route.type !== "session") return;
    const location = context.data.session.get(route.sessionID)?.location;
    if (location?.directory) return { sessionID: route.sessionID, location };
  };
  const show = (status) => {
    const checkedAt = status.checkedAt
      ? ` at ${new Date(status.checkedAt).toLocaleTimeString()}`
      : "";
    const current = status.preflight
      ? `; current check ${status.preflight.state}: ${status.preflight.reason}`
      : "";
    const lastEvent = status.lastEvent
      ? `; last event since plugin load: ${status.lastEvent.type} at ${new Date(status.lastEvent.receivedAt).toLocaleTimeString()}`
      : "; no allowlisted event received since plugin load";
    const message = `Model gate last: ${status.state}: ${status.reason}${checkedAt}${current}${lastEvent}`;
    if (!closed) context.ui.toast.show({ message });
  };

  context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: `${control.id}.status`,
      title: "Model gate: status",
      group: "Ticket model gate",
      palette: true,
      slash: { name: commandName },
      enabled: () => !closed && Boolean(target()),
      async run() {
        const current = target();
        if (!current || closed) return;
        try {
          const rpc = context.client.rpc(control);
          const status = await rpc.status(
            { sessionID: current.sessionID },
            { location: current.location, signal: AbortSignal.timeout(15_000) },
          );
          show(status);
        } catch {
          show({ state: "unavailable", reason: "status-unavailable" });
        }
      },
    }],
  }));

  return () => {
    closed = true;
  };
}

export default Plugin.define({ id, setup });
