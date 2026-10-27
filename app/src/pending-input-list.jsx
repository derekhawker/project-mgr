import { For, Show } from 'solid-js';
import { Button } from './ui/index.js';

export function PendingInputList(props) {
  return <>
    <Show when={props.message()}><li>{props.message()}</li></Show>
    <For each={props.items()}>{(item) => <li>
      <Show when={item.sessionId} fallback={<span>{item.label}</span>}>
        <Button onClick={() => props.onOpen(item.sessionId)}>{item.label}</Button>
      </Show>
    </li>}</For>
  </>;
}
