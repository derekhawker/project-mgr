import { createMemo, Show } from "solid-js";
import { createDocContentAdapter } from "./docContent.js";
import { Heading, Icon } from "@ui-lib";
import { FileTree } from "../../../components/file-navigation/FileTree.jsx";
import { FileNavigatorDivider } from "../../../components/file-navigation/FileNavigatorDivider.jsx";
import { WorkspaceTicketContent } from "../tickets/WorkspaceTicketContent.jsx";
import styles from "../../../application/workArea.module.css";

export function DocsPane(props) {
  const prepareContent = createDocContentAdapter(document.defaultView);
  const content = createMemo(() => prepareContent(props.content()));
  const ticketMetadata = () => props.ticketMetadata?.();
  const ticketFile = () => props.files().find((file) => file.isTicket);
  const repositoryFiles = () =>
    props.files().filter((file) => !file.isTicket);
  const isSelected = (file) =>
    props.selected()?.isTicket
      ? file.isTicket === true
      : props.selected()?.path === file.path &&
        props.selected()?.repositoryId === file.repositoryId;
  const renderFile = (file, basename) =>
    file.isTicket ? (
      <span class="docs-ticket-label">
        <Icon name="ticket" muted />
        Ticket
      </span>
    ) : basename;
  return (
    <section
      id="docs-page"
      class={`docs-page ${styles.docs}`}
      hidden={!props.visible()}
      role="tabpanel"
      aria-labelledby="show-docs"
      tabindex="0"
      style={{ "--navigator-width": `${props.navigatorWidth?.() ?? 285}px` }}
    >
      <aside
        class="docs-files"
        data-doc-files
        aria-label="Ticket and Markdown or text files"
      >
        <Show when={ticketFile()}>
          <FileTree
            files={[ticketFile()]}
            isSelected={isSelected}
            onSelect={props.onSelect}
            renderFile={renderFile}
          />
        </Show>
        <Show when={ticketFile() && repositoryFiles().length > 0}>
          <hr class={styles.ticketDivider} aria-hidden="true" />
        </Show>
        <FileTree
          files={repositoryFiles()}
          isSelected={isSelected}
          onSelect={props.onSelect}
          renderFile={renderFile}
        />
      </aside>
      <FileNavigatorDivider
        width={props.navigatorWidth}
        onResize={props.onNavigatorResize}
      />
      <section
        class="docs-content"
        data-doc-content
        data-page-message={props.pageMessage() ? "" : undefined}
      >
        <Show
          when={!props.pageMessage()}
          fallback={
            <p class="docs-message" role="status">
              {props.pageMessage()}
            </p>
          }
        >
          <Show
            when={props.content()}
            fallback={
              <p class="docs-message" role="status">
                {props.contentMessage()}
              </p>
            }
          >
            <Show
              when={props.selected()?.isTicket}
              fallback={
                <>
                  <Heading level={2} size="compact">
                    {props.content()?.path}
                  </Heading>
                  <Show
                    when={content()?.kind === "markdown"}
                    fallback={<pre class="docs-text">{content()?.text}</pre>}
                  >
                    <article
                      class="docs-markdown"
                      innerHTML={content()?.html}
                    />
                  </Show>
                </>
              }
            >
              <WorkspaceTicketContent
                content={() => props.content()?.contents}
                title={() => ticketMetadata()?.title}
                status={() => ticketMetadata()?.status}
                label={() => ticketMetadata()?.projectLabel}
              />
            </Show>
          </Show>
        </Show>
      </section>
    </section>
  );
}
