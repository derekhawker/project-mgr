import { createMemo, For, Show } from "solid-js";
import { createDocContentAdapter } from "./docContent.js";
import { Heading } from "@ui-lib";
import { FileTree } from "../../../components/file-navigation/FileTree.jsx";
import { FileNavigatorDivider } from "../../../components/file-navigation/FileNavigatorDivider.jsx";
import styles from "../../../application/workArea.module.css";

export function DocsPane(props) {
  const prepareContent = createDocContentAdapter(document.defaultView);
  const content = createMemo(() => prepareContent(props.content()));
  const groups = () => {
    const grouped = new Map();
    for (const file of props.files()) {
      const key = file.repositoryId || "";
      if (!grouped.has(key))
        grouped.set(key, {
          name: file.repositoryName || "Workspace",
          files: [],
        });
      grouped.get(key).files.push(file);
    }
    return [...grouped.values()];
  };
  return (
    <section
      id="docs-page"
      class={`docs-page ${styles.docs}`}
      hidden={!props.visible()}
      role="tabpanel"
      aria-labelledby="show-docs"
      tabindex="0"
      style={{ "--navigator-width": `${props.navigatorWidth?.() ?? 300}px` }}
    >
      <aside
        class="docs-files"
        data-doc-files
        aria-label="Markdown and text files"
      >
        <For each={groups()}>
          {(group) => (
            <section class="docs-source">
              <Heading level={2} size="section">
                {group.name}
              </Heading>
              <FileTree
                files={group.files}
                isSelected={(file) =>
                  props.selected()?.path === file.path &&
                  props.selected()?.repositoryId === file.repositoryId
                }
                onSelect={props.onSelect}
              />
            </section>
          )}
        </For>
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
            <Heading level={2} size="compact">
              {props.content()?.path}
            </Heading>
            <Show
              when={content()?.kind === "markdown"}
              fallback={<pre class="docs-text">{content()?.text}</pre>}
            >
              <article class="docs-markdown" innerHTML={content()?.html} />
            </Show>
          </Show>
        </Show>
      </section>
    </section>
  );
}
