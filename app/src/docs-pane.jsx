import { createMemo, For, Show } from 'solid-js';
import { createDocContentAdapter } from './doc-content.js';
import styles from './work-area.module.css';

export function DocsPane(props) {
  const prepareContent = createDocContentAdapter(document.defaultView);
  const content = createMemo(() => prepareContent(props.content()));
  const groups = () => {
    const grouped = new Map();
    for (const file of props.files()) {
      const key = file.repositoryId || '';
      if (!grouped.has(key)) grouped.set(key, { name: file.repositoryName || 'Workspace', files: [] });
      grouped.get(key).files.push(file);
    }
    return [...grouped.values()];
  };
  return <section id="docs-page" class={`docs-page ${styles.docs}`} hidden={!props.visible()} aria-label="Workspace documents">
      <aside class="docs-files" data-doc-files aria-label="Markdown and text files">
        <For each={groups()}>{(group) => <section class="docs-source"><h2>{group.name}</h2><ul>
          <For each={group.files}>{(file) => <li><button type="button" title={file.path}
            data-repository-id={file.repositoryId || undefined}
            aria-current={props.selected()?.path === file.path && props.selected()?.repositoryId === file.repositoryId ? 'true' : undefined}
            onClick={() => props.onSelect(file)}>{file.path}</button></li>}</For>
        </ul></section>}</For>
      </aside>
      <section class="docs-content" data-doc-content data-page-message={props.pageMessage() ? '' : undefined}>
        <Show when={!props.pageMessage()} fallback={<p class="docs-message" role="status">{props.pageMessage()}</p>}>
          <Show when={props.content()} fallback={<p class="docs-message" role="status">{props.contentMessage()}</p>}>
          <h2>{props.content()?.path}</h2>
          <Show when={content()?.kind === 'markdown'} fallback={<pre class="docs-text">{content()?.text}</pre>}>
            <article class="docs-markdown" innerHTML={content()?.html} />
          </Show>
          </Show>
        </Show>
      </section>
  </section>;
}
