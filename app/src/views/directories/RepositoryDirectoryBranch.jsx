import { For, Show } from "solid-js";
import { TreeFolder } from "../../components/TreeFolder.jsx";
import { RepositoryRow } from "./RepositoryRow.jsx";
import styles from "./RepositoryDirectories.module.css";

export function RepositoryDirectoryBranch(props) {
  return (
    <ul class={styles.children}>
      <For each={props.nodes}>
        {(node) => (
          <Show
            when={node.kind === "directory"}
            fallback={
              <RepositoryRow
                entry={node.entry}
                pendingRepositoryId={props.pendingRepositoryId}
                deleteMode={props.deleteMode}
                selectedIds={props.selectedIds}
                onToggleRepository={props.onToggleRepository}
                onStartDelete={props.onStartDelete}
                onToggleDelete={props.onToggleDelete}
              />
            }
          >
            <li>
              <TreeFolder
                node={node}
                label={node.name}
                isLeaf={(treeNode) => treeNode.kind === "repository"}
              >
                <RepositoryDirectoryBranch
                  nodes={node.children}
                  pendingRepositoryId={props.pendingRepositoryId}
                  deleteMode={props.deleteMode}
                  selectedIds={props.selectedIds}
                  onToggleRepository={props.onToggleRepository}
                  onStartDelete={props.onStartDelete}
                  onToggleDelete={props.onToggleDelete}
                />
              </TreeFolder>
            </li>
          </Show>
        )}
      </For>
    </ul>
  );
}
