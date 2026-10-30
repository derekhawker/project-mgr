import { Show } from "solid-js";
import { Icon } from "@ui-lib";
import styles from "./PortsEmptyState.module.css";

/** Empty result presentation for the Ports page. `filtered` distinguishes an
 * empty filter result from a machine with no visible listeners. */
export function PortsEmptyState(props) {
  return (
    <div class={styles.emptyState} role="status">
      <Icon name="ports" class={styles.icon} />
      <h2>{props.filtered ? "No processes match these ports" : "No processes are running on these ports"}</h2>
      <Show when={!props.filtered}>
        <p>No accessible listening processes were found.</p>
      </Show>
    </div>
  );
}
