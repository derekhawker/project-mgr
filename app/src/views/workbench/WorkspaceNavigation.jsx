import { For, Show } from "solid-js";
import { Button, Icon } from "@ui-lib";
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
            const repositoryCount = () =>
              (props.data()?.workspaceRepositories || []).filter(
                (binding) =>
                  binding.workspaceId === workspace.id &&
                  binding.verificationStatus === "verified",
              ).length;
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
                  <Show when={repositoryCount() > 0}>
                    <span
                      class={styles.repositoryIndicator}
                      aria-hidden="true"
                      title={`${repositoryCount()} associated Git ${repositoryCount() === 1 ? "repository" : "repositories"}`}
                    >
                      <Icon name="branch" muted />
                    </span>
                  </Show>
                </Button>
              </li>
            );
          }}
        </For>
      </Show>
    </ul>
  );
}
