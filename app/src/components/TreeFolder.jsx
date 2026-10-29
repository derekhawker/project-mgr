import { createSignal, Show } from "solid-js";
import { Icon } from "@ui-lib";
import styles from "./TreeFolder.module.css";

function countLeaves(node, getChildren, isLeaf) {
  if (isLeaf(node)) return 1;
  return getChildren(node).reduce(
    (count, child) => count + countLeaves(child, getChildren, isLeaf),
    0,
  );
}

export function TreeFolder(props) {
  const [expanded, setExpanded] = createSignal(true);
  const getChildren = props.getChildren || ((node) => node.children || []);
  const isLeaf = props.isLeaf || ((node) => getChildren(node).length === 0);
  const leafCount = () => countLeaves(props.node, getChildren, isLeaf);

  return (
    <details open on:toggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary class={styles.folder}>
        <Icon name="chevron" class={styles.disclosure} muted />
        <Icon name="folder" class={styles.closedFolder} muted />
        <Icon name="folderOpen" class={styles.openFolder} muted />
        <span class={styles.label}>{props.label}</span>
        <Show when={!expanded() && leafCount() > 0}>
          <span
            class={styles.hiddenCount}
            aria-label={`${leafCount()} hidden leaf nodes`}
          >
            <span class={styles.countText}>{leafCount()}</span>
          </span>
        </Show>
      </summary>
      {props.children}
    </details>
  );
}
