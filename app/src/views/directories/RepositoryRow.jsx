import { Show } from "solid-js";
import { Checkbox, Icon, Status } from "@ui-lib";
import { DeleteButton } from "../../components/DeleteButton.jsx";
import styles from "./RepositoryDirectories.module.css";

export function RepositoryRow(props) {
  const repository = () => props.entry.repository;
  return (
    <li class={styles.repositoryItem}>
      <div class={styles.repositoryRow}>
        <label class={styles.repositoryLabel}>
          <Show
            when={props.deleteMode()}
            fallback={
              <Checkbox
                aria-label={`Enable repository ${repository().name}`}
                checked={props.entry.enabled}
                disabled={props.pendingRepositoryId() === repository().id}
                onChange={(event) =>
                  props.onToggleRepository(
                    repository(),
                    event.currentTarget.checked,
                  )
                }
              />
            }
          >
            <Checkbox
              aria-label={`Select repository ${repository().name} for deletion`}
              checked={props.selectedIds().has(repository().id)}
              onChange={() => props.onToggleDelete(repository().id)}
            />
          </Show>
          <span class={styles.repositoryPath} title={repository().repositoryPath}>
            <strong>{repository().name}</strong>
            {` — ${repository().repositoryPath}`}
          </span>
        </label>
        <Show
          when={props.deleteMode()}
          fallback={
            <DeleteButton
              itemName={`Repository ${repository().name}`}
              onClick={() => props.onStartDelete(repository().id)}
            />
          }
        >
          <Status>{props.entry.enabled ? "Enabled" : "Disabled"}</Status>
        </Show>
      </div>
    </li>
  );
}
