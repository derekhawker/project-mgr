import { For, Show } from "solid-js";
import { Icon, IconButton } from "@ui-lib";
import styles from "./PortProcessItem.module.css";

export function PortProcessItem(props) {
  const row = () => props.row;
  return <article class={styles.item}>
    <IconButton variant="danger" label={props.stopping ? "Stopping process" : `Stop ${row().name || "process"} (PID ${row().pid})`} disabled={!row().identity || props.stopping} onClick={() => props.onStop(row())}><Icon name="close" /></IconButton>
    <details class={styles.content}>
      <summary class={styles.summary}>
        <Icon name="chevron" class={styles.chevron} />
        <span class={styles.summaryContent}>
        <span class={styles.primary}><span class={styles.portList} aria-label="Ports"><For each={row().ports}>{port => <strong class={styles.ports}>{port}</strong>}</For></span><code class={styles.command}>{row().command || "Command unavailable (possibly permission-restricted)"}</code></span>
        <span class={styles.identity}><span class={styles.process}>{row().name || "Unknown process"}</span><span class={styles.pid}>PID {row().pid}</span></span>
        </span>
      </summary>
    <div class={styles.details}>
      <span><strong>Owner:</strong> {row().owner || "Unavailable"}</span>
      <span><strong>Bind addresses:</strong> {row().addresses.join(", ") || "Unavailable"}</span>
      <span><strong>Working directory:</strong> {row().cwd || "Unavailable (possibly permission-restricted)"}</span>
      <span><strong>Started:</strong> {row().startTime || "Unavailable"}</span>
    </div>
    <Show when={row().addresses.some(a => a.includes("all interfaces"))}><p class={styles.exposure}>Bound to all interfaces. Other devices may be able to reach this service, subject to network and firewall rules.</p></Show>
    </details>
  </article>;
}
