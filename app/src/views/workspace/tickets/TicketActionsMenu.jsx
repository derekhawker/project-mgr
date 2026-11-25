import { ActionMenu, ActionMenuItem } from "@ui-lib";

/** Lifecycle actions do not affect the ticket's OpenCode session. */
export function TicketActionsMenu(props) {
  const cancelled = () => props.archived && props.ticket.status === "cancelled";
  const activeSession = () =>
    !props.archived &&
    props.ticket.hasWorkSession &&
    ["starting", "running", "retrying", "waiting_for_input"].includes(
      props.ticket.opencodeStatus,
    );
  return (
    <ActionMenu
      label={`Actions for ticket: ${props.ticket.title}`}
      triggerText="Actions"
      actionsLabel={`Ticket actions: ${props.ticket.title}`}
      triggerVariant="compact"
      portal
      disabled={props.disabled}
    >
      <ActionMenuItem
        disabled={!cancelled() && activeSession()}
        title={
          !cancelled() && activeSession()
            ? "Wait for the OpenCode session to finish before cancelling."
            : undefined
        }
        onClick={() =>
          cancelled()
            ? props.onUncancel(props.ticket.filename)
            : props.onCancel(props.ticket.filename)
        }
      >
        {cancelled()
          ? "Uncancel ticket"
          : activeSession()
            ? "Cancel ticket (session active)"
            : "Cancel ticket"}
      </ActionMenuItem>
    </ActionMenu>
  );
}
