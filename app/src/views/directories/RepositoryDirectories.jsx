import { createSignal, For, Show } from "solid-js";
import { Button } from "@ui-lib";
import { TreeFolder } from "../../components/TreeFolder.jsx";
import { RepositoryDirectoryBranch } from "./RepositoryDirectoryBranch.jsx";
import { buildRepositoryDirectoryTree } from "./directoryGroups.js";
import styles from "./RepositoryDirectories.module.css";

export function RepositoryDirectories(props) {
  const [deleteMode, setDeleteMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal(new Set());
  const roots = () => buildRepositoryDirectoryTree(props.directories());
  const startDelete = (repositoryId) => {
    setSelectedIds(new Set([repositoryId]));
    setDeleteMode(true);
  };
  const toggleDelete = (repositoryId) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(repositoryId)) next.delete(repositoryId);
      else next.add(repositoryId);
      return next;
    });
  const cancelDelete = () => {
    setDeleteMode(false);
    setSelectedIds(new Set());
  };

  return (
    <section class={styles.navigator} aria-label="Repository directories">
      <Show when={deleteMode()}>
        <div class={styles.bulkActions}>
          <Button onClick={cancelDelete}>Cancel</Button>
          <Button
            aria-label="Delete selected repositories"
            variant="danger"
            disabled={!selectedIds().size}
            onClick={() => {
              void props.onDeleteMany([...selectedIds()]).then(cancelDelete);
            }}
          >
            Delete selected ({selectedIds().size})
          </Button>
        </div>
      </Show>
      <ul
        id="directory-list"
        class={styles.rootList}
        aria-label="Repositories grouped by directory"
      >
        <Show
          when={roots().length > 0}
          fallback={<li class={styles.empty}>No directories saved yet.</li>}
        >
          <For each={roots()}>
            {(root) => (
              <li class={styles.root}>
                <TreeFolder
                  node={root}
                  label={<span title={root.path}>{root.path}</span>}
                  isLeaf={(treeNode) => treeNode.kind === "repository"}
                >
                  <RepositoryDirectoryBranch
                    nodes={root.children}
                    pendingRepositoryId={props.pendingRepositoryId}
                    deleteMode={deleteMode}
                    selectedIds={selectedIds}
                    onToggleRepository={props.onToggleRepository}
                    onStartDelete={startDelete}
                    onToggleDelete={toggleDelete}
                  />
                </TreeFolder>
              </li>
            )}
          </For>
        </Show>
      </ul>
    </section>
  );
}
