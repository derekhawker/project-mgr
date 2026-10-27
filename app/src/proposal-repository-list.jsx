import { For, Show } from 'solid-js';

export function ProposalRepositoryList(props) {
  return <Show when={props.repositories().length > 0} fallback={<li>None</li>}>
    <For each={props.repositories()}>{(repository) => <li title={repository.path}>
      {repository.name} — {repository.path}
    </li>}</For>
  </Show>;
}
