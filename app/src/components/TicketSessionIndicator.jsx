import { Show } from "solid-js";
import { Icon } from "@ui-lib";
import styles from "./TicketSessionIndicator.module.css";

export function ticketSessionIndicator({ ticketStatus, hasWorkSession, opencodeStatus }) {
  if (ticketStatus === "in_progress" && !hasWorkSession) {
    return { icon: "caution", label: "Ticket has no work session", kind: "error" };
  }

  if (opencodeStatus === "waiting_for_input") {
    return {
      icon: "questionBubble",
      label: "OpenCode is waiting for your input",
      kind: "question",
    };
  }

  if (opencodeStatus === "idle" || opencodeStatus === "ready_for_review") {
    return { icon: "pause", label: "OpenCode session is paused", kind: "paused" };
  }

  if (["failed", "reconnecting", "unknown"].includes(opencodeStatus)) {
    return {
      icon: "caution",
      label: `OpenCode session needs attention: ${opencodeStatus.replaceAll("_", " ")}`,
      kind: "error",
    };
  }

  return null;
}

export function TicketSessionIndicator(props) {
  const indicator = () => ticketSessionIndicator(props);
  return (
    <Show when={indicator()}>
      {(state) => (
        <span class={styles.indicator} role="img" aria-label={state().label}>
          <Icon
            name={state().icon}
            size="small"
            class={styles[state().kind]}
          />
        </span>
      )}
    </Show>
  );
}
