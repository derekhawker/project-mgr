import { Button, Tab } from "@ui-lib";
import { For, Show } from "solid-js";

export function SessionTabList(props) {
  return (
    <For each={props.tabs()}>
      {(entry) => (
        <Tab
          value={entry.sessionId}
          id={`session-tab-${entry.sessionId}`}
          disabled={entry.disabled}
          hidden={!entry.visible}
          data-session-id={entry.sessionId}
          data-owner-key={entry.ownerKey}
          controls={`terminal-${entry.sessionId}`}
          aria-label={`Open ${entry.label}`}
          onClick={entry.onSelect}
          onClose={entry.closeable ? entry.onClose : undefined}
          closeLabel={`Close ${entry.label}`}
          actions={
            <Show when={entry.restartable}>
              <Button
                type="button"
                data-restart-session={entry.sessionId}
                aria-label={`Restart terminal for ${entry.label}`}
                hidden={entry.restartHidden}
                disabled={entry.restartBusy}
                onClick={entry.onRestart}
              >
                Restart
              </Button>
            </Show>
          }
        >
          {entry.label}
        </Tab>
      )}
    </For>
  );
}
