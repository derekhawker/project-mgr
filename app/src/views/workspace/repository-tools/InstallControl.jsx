import { createSignal, onMount } from "solid-js";
import { ActionMenuItem } from "@ui-lib";

export function InstallControl(props) {
  const [status, setStatus] = createSignal(
    "Dependencies missing · npm install",
  );
  const [hidden, setHidden] = createSignal(false);
  const [disabled, setDisabled] = createSignal(true);
  onMount(() =>
    props.onInstall(props.repository, { setStatus, setHidden, setDisabled }),
  );
  return (
    <>
      <p role="status">{status()}</p>
      <ActionMenuItem disabled={disabled()} hidden={hidden()}>
        Run npm install
      </ActionMenuItem>
    </>
  );
}
