import {
  ActionMenu,
  ActionMenuItem,
  ActionMenuGroup,
  ActionMenuSeparator,
} from "@ui-lib";
import styles from "./RepositoryToolsMenu.module.css";
import { For, Show, createSignal } from "solid-js";
import { InstallControl } from "./InstallControl.jsx";

const handoffActions = [
  ["shell", "Open terminal"],
  ["idea", "Open in IntelliJ"],
  ["folder", "Show in folder"],
];

export function RepositoryToolsMenu(props) {
  const [handoffStatus, setHandoffStatus] = createSignal("");
  const [handoffHidden, setHandoffHidden] = createSignal(true);
  const [handoffDisabled, setHandoffDisabled] = createSignal(false);
  return (
    <ActionMenu
      class={styles.menu}
      label="Tools"
      triggerId="show-repo-tools"
      contentId="repo-tools-menu"
      contentClass={styles.content}
      actionsLabel="Repository tools"
      disabled={props.disabled()}
      hidden={!props.available()}
      open={props.open()}
      onRequestToggle={props.onToggle}
      onRequestClose={props.onToggle}
      closeOnSelect={false}
    >
      <ActionMenuGroup label="Open in…">
        <For each={handoffActions}>
          {([action, label]) => (
            <ActionMenuItem
              type="button"
              disabled={handoffDisabled()}
              onClick={() =>
                props.onHandoff(action, {
                  setStatus: setHandoffStatus,
                  setHidden: setHandoffHidden,
                  setDisabled: setHandoffDisabled,
                })
              }
            >
              {label}
            </ActionMenuItem>
          )}
        </For>
        <p class={styles.handoffStatus} role="status" hidden={handoffHidden()}>
          {handoffStatus()}
        </p>
      </ActionMenuGroup>
      <Show when={props.error()}>
        <p class={styles.handoffStatus} role="status">
          {props.error()}
        </p>
      </Show>
      <Show when={props.groups().length > 0}>
        <ActionMenuSeparator />
        <div class={styles.repositories}>
          <For each={props.groups()}>
            {(repository) => (
              <ActionMenuGroup label={repository.name} class={styles.group}>
                <Show when={repository.npmInstallNeeded}>
                  <InstallControl
                    repository={repository}
                    onInstall={props.onInstall}
                  />
                </Show>
                <For
                  each={[
                    ["npm_script", repository.packageScripts],
                    ["make_target", repository.makeTargets],
                  ]}
                >
                  {([kind, names]) => (
                    <Show when={names.length > 0}>
                      <ActionMenuGroup
                        label={
                          kind === "npm_script" ? "package.json" : "Makefile"
                        }
                        headingLevel={3}
                      >
                        <For each={names}>
                          {(name) => (
                            <ActionMenuItem
                              type="button"
                              onClick={() =>
                                props.onRun(repository, kind, name)
                              }
                            >
                              {name}
                            </ActionMenuItem>
                          )}
                        </For>
                      </ActionMenuGroup>
                    </Show>
                  )}
                </For>
              </ActionMenuGroup>
            )}
          </For>
        </div>
      </Show>
    </ActionMenu>
  );
}
