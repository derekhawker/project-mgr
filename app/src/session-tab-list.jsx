import { Button } from './ui/index.js';
import { For, Show } from 'solid-js';

export function SessionTabList(props) {
  return <For each={props.tabs()}>{(entry) => (
    <div class="session-tab-item" role="presentation" hidden={!entry.visible}>
      <Button type="button" id={`session-tab-${entry.sessionId}`} role="tab"
        disabled={entry.disabled}
        data-session-id={entry.sessionId} data-owner-key={entry.ownerKey}
        aria-controls={`terminal-${entry.sessionId}`} aria-selected={String(entry.selected)} tabindex={entry.selected ? '0' : '-1'}
        class={entry.selected ? 'selected' : ''} aria-label={`Open ${entry.label}`} onClick={entry.onSelect}>{entry.label}</Button>
      <Show when={entry.restartable}>
        <Button type="button" class="session-tab-restart" data-restart-session={entry.sessionId}
          aria-label={`Restart terminal for ${entry.label}`} hidden={entry.restartHidden}
          disabled={entry.restartBusy} onClick={entry.onRestart}>Restart</Button>
      </Show>
      <Show when={entry.closeable}>
        <Button type="button" class="session-tab-close" aria-label={`Close ${entry.label}`}
          onClick={entry.onClose}>×</Button>
      </Show>
    </div>
  )}</For>;
}
