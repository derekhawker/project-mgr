import { For, Show } from 'solid-js';
import { Button } from './ui/index.js';

export function QuickRequestList(props) {
  const records = () => props.records();
  const emptyMessage = () => props.history()
    ? (props.query().trim() ? 'No Quick Requests match your search.' : 'No Quick Requests yet.')
    : 'None yet';
  return (
    <Show when={records().length > 0} fallback={<li>{emptyMessage()}</li>}>
      <For each={records()}>{(record) => {
        const prompt = () => record.prompt ?? 'Prompt unavailable';
        return (
          <li classList={{ 'quick-request-navigation-item': !props.history(), 'quick-request-row': props.history() }}>
            <Show when={props.history()} fallback={<button type="button"
              classList={{ selected: props.selectedId() === record.task.id }} title={prompt()}
              onClick={() => props.onOpen(record)}>{prompt()}</button>}>
              <Button aria-label={`Open Quick Request: ${prompt()}`} onClick={() => props.onOpen(record)}>Open</Button>
            </Show>
            <Show when={props.history()}><span class="quick-request-prompt">{prompt()}</span></Show>
            <Show when={props.history()}>
              <Button class="quick-request-delete" onClick={() => props.onDelete(record)}>Delete</Button>
            </Show>
          </li>
        );
      }}</For>
    </Show>
  );
}
