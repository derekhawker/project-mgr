import { For, Show } from "solid-js";
import { Button, Checkbox, Icon, IconButton } from "@ui-lib";
import { DeleteButton } from "../../components/DeleteButton.jsx";
import { NavigationItem } from "../../components/NavigationItem.jsx";
import { OpenItemButton } from "../../components/OpenItemButton.jsx";
import styles from "./QuickRequestList.module.css";

export function QuickRequestList(props) {
  const records = () => props.records();
  const emptyMessage = () =>
    props.history()
      ? props.query().trim()
        ? "No Quick Requests match your search."
        : "No Quick Requests yet."
      : "-";
  return (
    <Show when={records().length > 0} fallback={null}>
      <For each={records()}>
        {(record) => {
          const prompt = () => record.prompt ?? "Prompt unavailable";
          return (
            <li
              classList={{
                "quick-request-navigation-item": !props.history(),
                [styles.row]: props.history(),
              }}
            >
              <Show when={!props.history()}>
                <NavigationItem
                  current={props.selectedId() === record.task.id}
                  title={prompt()}
                  onClick={() => props.onOpen(record)}
                >
                  <span class={styles.navigationPrompt}>{prompt()}</span>
                </NavigationItem>
              </Show>
              <Show when={props.history() && props.deleteMode?.()}>
                <label class={styles.select}>
                  <Checkbox
                    aria-label={`Select Quick Request for deletion: ${prompt()}`}
                    checked={props.selectedDeleteIds().has(record.task.id)}
                    onChange={() => props.onToggleDelete(record.task.id)}
                  />
                  <span class={styles.prompt}>{prompt()}</span>
                </label>
              </Show>
              <Show when={props.history() && !props.deleteMode?.()}>
                <span class={styles.prompt}>{prompt()}</span>
              </Show>
              <Show when={props.history()}>
                <OpenItemButton
                  itemType="Quick Request"
                  itemName={prompt()}
                  onClick={() => props.onOpen(record)}
                />
              </Show>
              <Show when={props.history() && !props.deleteMode?.()}>
                <DeleteButton
                  itemName={`Quick Request: ${prompt()}`}
                  onClick={() => props.onDelete(record)}
                />
              </Show>
            </li>
          );
        }}
      </For>
    </Show>
  );
}
