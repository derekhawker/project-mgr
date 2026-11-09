import { Status } from "@ui-lib";
import styles from "./TicketStatusBadge.module.css";

const labels = {
  blocked: "Blocked",
  in_progress: "In progress",
  draft: "Draft",
  done: "Done",
  cancelled: "Cancelled",
};

export function TicketStatusBadge(props) {
  const label = () => labels[props.status] ?? props.status;
  return (
    <Status
      class={styles.badge}
      label={`Status: ${label()}`}
    >
      {label()}
    </Status>
  );
}
