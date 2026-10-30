import { For, Show } from "solid-js";
import { Button } from "@ui-lib";
import styles from "../../application/navigation.module.css";

/** Reactive Workspace navigation list; selection remains owned by the app shell. */
export function WorkspaceNavigation(props) {
  const workspaces = () =>
    (props.data()?.workspaces || []).filter(
      (workspace) =>
        workspace.kind === "regular" && workspace.status === "active",
    );

  return (
    <ul id="workspace-list" aria-busy={String(props.busy())}>
      <Show
        when={workspaces().length > 0}
        fallback={
          <li class={styles.emptyState}>
            No workspaces yet. Use <strong>New</strong> below to create one.
          </li>
        }
      >
        <For each={workspaces()}>
          {(workspace) => {
            return (
              <li>
                <Button
                  type="button"
                  class={styles.workspaceButton}
                  aria-current={
                    props.selected()?.id === workspace.id ? "page" : undefined
                  }
                  onClick={() => props.onSelect(workspace)}
                >
                  <span class={styles.workspaceName}>{workspace.name}</span>
                </Button>
              </li>
            );
          }}
        </For>
      </Show>
    </ul>
  );
}
