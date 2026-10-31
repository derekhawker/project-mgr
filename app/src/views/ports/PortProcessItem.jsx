import { For, Show } from "solid-js";
import { Icon, IconButton } from "@ui-lib";
import styles from "./PortProcessItem.module.css";

export function PortProcessItem(props) {
  const row = () => props.row;
  let details;
  const toggleFromItem = (event) => {
    if (event.target.closest("summary, button, a, input, select, textarea")) return;
    if (details) details.open = !details.open;
  };
  return <article class={styles.item} onClick={toggleFromItem}>
    <IconButton variant="danger" label={props.stopping ? "Stopping process" : `Stop ${row().name || "process"} (PID ${row().pid})`} disabled={!row().identity || props.stopping} onClick={() => props.onStop(row())}><Icon name="close" /></IconButton>
    <details ref={(el) => { details = el; }} class={styles.content}>
      <summary class={styles.summary}>
        <Icon name="chevron" class={styles.chevron} />
        <span class={styles.summaryContent}>
        <span class={styles.primary}><span class={styles.portList} aria-label="Ports"><For each={row().ports}>{port => <strong class={styles.ports}>{port}</strong>}</For></span><code class={styles.command}>{row().command || "Command unavailable (possibly permission-restricted)"}</code></span>
        <span class={styles.identity}><span class={styles.process}>{row().name || "Unknown process"}</span><span class={styles.pid}>PID {row().pid}</span></span>
        </span>
      </summary>
    <dl class={styles.details}>
      <div class={styles.detail}><dt>Process</dt><dd>{row().name || "Unknown process"}</dd></div>
      <div class={styles.detail}><dt>PID</dt><dd>{row().pid}</dd></div>
      <div class={styles.detail}><dt>Owner</dt><dd>{row().owner || "Unavailable"}</dd></div>
      <div class={styles.detail}><dt>Bind addresses</dt><dd>{row().addresses.join(", ") || "Unavailable"}</dd></div>
      <div class={styles.detail}><dt>Working directory</dt><dd>{row().cwd || "Unavailable (possibly permission-restricted)"}</dd></div>
      <div class={styles.detail}><dt>Started</dt><dd>{row().startTime || "Unavailable"}</dd></div>
    </dl>
    <Show when={row().addresses.some(a => a.includes("all interfaces"))}><p class={styles.exposure}>Bound to all interfaces. Other devices may be able to reach this service, subject to network and firewall rules.</p></Show>
    </details>
  </article>;
}
