import { createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "@ui-lib";
import styles from "./WorkspaceTicketViewer.module.css";

/** Simple Markdown-backed ticket browser. Selection is intentionally read-only. */
export function WorkspaceTicketViewer(props) {
  const [localArchived, setArchived] = createSignal(false);
  const archived = () => props.archived ? props.archived() : localArchived();
  const selected = createMemo(() =>
    props.tickets().find((ticket) => ticket.filename === props.selectedFilename()),
  );
  return (
    <section aria-label="Workspace tickets" class={styles.viewer}>
      <header class={styles.header}>
        <h2>{archived() ? "Archived tickets" : "Tickets"}</h2>
        <Button type="button" onClick={props.onCreate}>Create ticket with OpenCode</Button>
        <Button type="button" onClick={props.onRefresh}>Refresh tickets</Button>
        <Button type="button" onClick={() => { const next = !archived(); setArchived(next); props.onArchiveChange(next); props.onSelect(null); }}>
          {archived() ? "Show active tickets" : "Browse archived tickets"}
        </Button>
      </header>
      <Show when={props.error()}>{(error) => <p role="alert">{error()}</p>}</Show>
      <Show when={!props.loading()} fallback={<p role="status">Loading tickets…</p>}>
        <Show when={props.tickets().length} fallback={<p>No {archived() ? "archived " : ""}tickets.</p>}>
          <ul class={styles.list} aria-label={archived() ? "Archived tickets" : "Tickets"}>
            <For each={props.tickets()}>{(ticket) =>
              <li>
                <button type="button" aria-pressed={props.selectedFilename() === ticket.filename} onClick={() => props.onSelect(ticket.filename)}>
                  <strong>{ticket.title}</strong><span class={styles.status}>{ticket.status}</span>
                </button>
                <p class={styles.preview}>{ticket.content.slice(0, 280)}{ticket.content.length > 280 ? "…" : ""}</p>
              </li>
            }</For>
          </ul>
        </Show>
      </Show>
      <Show when={selected()}>{(ticket) =>
        <article class={styles.detail} aria-label={`Selected ticket: ${ticket().title}`}>
          <h3>{ticket().title}</h3><p>Status: {ticket().status}</p>
          <Show when={!archived()}><Button type="button" disabled={props.working?.() ?? false} onClick={() => props.onWork?.(ticket().filename)}>Work</Button></Show>
          <pre>{ticket().content.slice(0, 1200)}{ticket().content.length > 1200 ? "…" : ""}</pre>
        </article>
      }</Show>
    </section>
  );
}
