import { createMemo, For, Show } from "solid-js";
import { renderTicketMarkdown, splitTicketFrontmatter } from "./ticketContent.js";
import styles from "./WorkspaceTicketViewer.module.css";

export function WorkspaceTicketContent(props) {
  const content = () => props.content?.() ?? "";
  const fields = createMemo(() =>
    splitTicketFrontmatter(content()).fields.filter(
      ([key]) => key !== "opencode-status",
    ),
  );
  const markdown = createMemo(() => renderTicketMarkdown(content(), window));
  const title = () =>
    props.title?.() ??
    fields().find(([key]) => key === "title")?.[1] ??
    "Ticket";

  return (
    <article
      class={styles.detail}
      aria-label={`Selected ticket: ${title()}`}
    >
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
