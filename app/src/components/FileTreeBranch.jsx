import { For, Show } from "solid-js";
import { TreeFolder } from "./TreeFolder.jsx";
import styles from "./FileTree.module.css";

export function FileTreeBranch(props) {
  return (
    <ul class={styles.list}>
      <For each={props.nodes}>
        {(node) => (
          <li>
            <Show
              when={node.children}
              fallback={
                <button
                  type="button"
                  class={styles.file}
                  title={node.file?.path}
                  aria-current={
                    props.isSelected?.(node.file) ? "true" : undefined
                  }
                  onClick={() => props.onSelect(node.file)}
                >
                  {props.renderFile
                    ? props.renderFile(node.file, node.name)
                    : node.name}
                </button>
              }
            >
              <TreeFolder node={node} label={node.name}>
                <FileTreeBranch
                  nodes={node.children}
                  onSelect={props.onSelect}
                  isSelected={props.isSelected}
                  renderFile={props.renderFile}
                />
              </TreeFolder>
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}
