import { For, Show } from 'solid-js';
import { Checkbox } from './ui/index.js';

export function RepositoryDirectories(props) {
  return (
    <Show when={props.groups().length > 0} fallback={<li>No directories saved yet.</li>}>
      <For each={props.groups()}>{(directory) => (
        <li>
          <h2>{directory.path}</h2>
          <ul>
            <Show when={directory.repositories.length > 0} fallback={<li>No repositories discovered here.</li>}>
              <For each={directory.repositories}>{(entry) => (
                <li>
                  <label>
                    <Checkbox checked={entry.enabled}
                      disabled={props.pendingRepositoryId() === entry.repository.id}
                      onChange={(event) => props.onToggle(entry.repository, event.currentTarget.checked)} />
                    {` ${entry.repository.name} — ${entry.repository.repositoryPath}`}
                  </label>
                </li>
              )}</For>
            </Show>
          </ul>
        </li>
      )}</For>
    </Show>
  );
}
