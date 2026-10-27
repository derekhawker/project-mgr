import { Show } from 'solid-js';

export function NoSelection({ visible, workspaceSelected }) {
  return <div id="no-selection" class="no-selection" hidden={!visible()}>
    <Show when={!workspaceSelected()}>
      <section id="workspaces-unselected" aria-labelledby="unselected-title">
        <h1 id="unselected-title">Select a Workspace, or choose New work to start.</h1>
      </section>
    </Show>
  </div>;
}
