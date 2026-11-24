import { createMemo, For, Show } from "solid-js";
import { renderTicketMarkdown, splitTicketFrontmatter } from "./ticketContent.js";
import { TicketStatusBadge } from "./TicketStatusBadge.jsx";
import styles from "./WorkspaceTicketViewer.module.css";

export function WorkspaceTicketContent(props) {
  const content = () => props.content?.() ?? "";
  const fields = createMemo(() =>
    splitTicketFrontmatter(content()).fields.filter(
      ([key]) => key !== "opencode-status",
    ),
  );
  const field = (name) => fields().find(([key]) => key === name)?.[1];
  const title = () =>
    props.title?.() ??
    field("title") ??
    "Ticket";
  const status = () => props.status?.() ?? field("status") ?? "draft";
  const label = () => props.label?.() ?? field("project_label");
  const markdown = createMemo(() =>
    renderTicketMarkdown(content(), window, title()),
  );

  return (
    <article
      class={styles.detail}
      aria-label={`Selected ticket: ${title()}`}
    >
      <header class={styles.ticketHeader}>
        <h2 class={styles.ticketHeading}>
          <TicketStatusBadge status={status()} />
          <Show when={label()}>
            {(projectLabel) => (
              <span>{` ${projectLabel()} `}</span>
            )}
          </Show>
          <span aria-hidden="true"> - </span>
          <strong>{title()}</strong>
        </h2>
      </header>
      <div class={styles.markdown} innerHTML={markdown()} />
      <Show when={fields().length}>
        <section class={styles.frontmatter} aria-label="Ticket metadata">
          <h4>Ticket metadata</h4>
          <dl>
            <For each={fields()}>
              {([key, value]) => (
                <>
                  <dt>{key}</dt>
                  <dd>{value || "—"}</dd>
                </>
              )}
            </For>
          </dl>
        </section>
      </Show>
    </article>
  );
}
