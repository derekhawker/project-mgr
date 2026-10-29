import { Show } from "solid-js";
import { Heading } from "@ui-lib";
import styles from "./NoSelection.module.css";

export function NoSelection({ visible, workspaceSelected }) {
  return (
    <div id="no-selection" class={styles.root} hidden={!visible()}>
      <Show when={!workspaceSelected()}>
        <section id="workspaces-unselected" aria-labelledby="unselected-title">
          <Heading level={1} size="hero" id="unselected-title">
            Select a Workspace, or choose New work to start.
          </Heading>
        </section>
      </Show>
    </div>
  );
}
