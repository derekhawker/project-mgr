import { For, Show } from 'solid-js';
import { Button } from './ui/index.js';
import styles from './navigation.module.css';

/** Reactive Workspace navigation list; selection remains owned by the app shell. */
export function WorkspaceNavigation(props) {
  const workspaces = () => (props.data()?.workspaces || []).filter((workspace) =>
    workspace.kind === 'regular' && workspace.status === 'active');

  return (
    <ul id="workspace-list" aria-busy={String(props.busy())}>
      <Show when={workspaces().length > 0} fallback={<li class="placeholder">No workspaces yet</li>}>
        <For each={workspaces()}>{(workspace) => {
          const repositoryCount = () => (props.data()?.workspaceRepositories || []).filter((binding) =>
            binding.workspaceId === workspace.id && binding.verificationStatus === 'verified').length;
          return (
            <li>
              <Button
                type="button"
                class={styles.workspaceButton}
                classList={{ 'workspace-navigation-button': true, selected: props.selected()?.id === workspace.id }}
                aria-current={props.selected()?.id === workspace.id ? 'page' : undefined}
                onClick={() => props.onSelect(workspace)}
              >
                <span>{workspace.name}</span>
                <Show when={repositoryCount() > 0}>
                  <span class="workspace-repository-indicator" aria-hidden="true" title={`${repositoryCount()} associated Git ${repositoryCount() === 1 ? 'repository' : 'repositories'}`}>
                    <svg viewBox="0 0 16 16" focusable="false"><path d="M5 3v10m6-10v3a2 2 0 0 1-2 2H7a2 2 0 0 0-2 2m6-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>
                  </span>
                </Show>
              </Button>
            </li>
          );
        }}</For>
      </Show>
    </ul>
  );
}
