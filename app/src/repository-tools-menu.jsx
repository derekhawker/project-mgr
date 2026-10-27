import { ActionMenu, Button } from './ui/index.js';
import { For, Show, onMount, createSignal } from 'solid-js';

const handoffActions = [['shell', 'Open terminal'], ['idea', 'Open in IntelliJ'], ['folder', 'Show in folder']];

function InstallControl(props) {
  const [status, setStatus] = createSignal('Dependencies missing · npm install');
  const [hidden, setHidden] = createSignal(false);
  const [disabled, setDisabled] = createSignal(true);
  onMount(() => props.onInstall(props.repository, { setStatus, setHidden, setDisabled }));
  return <>
    <p role="status">{status()}</p>
    <Button type="button" disabled={disabled()} hidden={hidden()}>Run npm install</Button>
  </>;
}

export function RepositoryToolsMenu(props) {
  const [handoffStatus, setHandoffStatus] = createSignal('');
  const [handoffHidden, setHandoffHidden] = createSignal(true);
  const [handoffDisabled, setHandoffDisabled] = createSignal(false);
  return <ActionMenu label="Tools" triggerId="show-repo-tools" triggerClass="toolbar-tab"
    contentId="repo-tools-menu" contentClass="repo-tools-menu" actionsLabel="Repository tools"
    disabled={props.disabled()} hidden={!props.available()} open={props.open()}
    onRequestToggle={props.onToggle} onRequestClose={props.onToggle} closeOnSelect={false}>
    <section class="repo-tools-handoff">
      <h2>Open in…</h2>
      <For each={handoffActions}>{([action, label]) =>
        <Button type="button" disabled={handoffDisabled()} onClick={() => props.onHandoff(action, { setStatus: setHandoffStatus, setHidden: setHandoffHidden, setDisabled: setHandoffDisabled })}>{label}</Button>
      }</For>
      <p class="repo-tools-handoff-status" role="status" hidden={handoffHidden()}>{handoffStatus()}</p>
    </section>
    <Show when={props.error()}><p class="repo-tools-handoff-status" role="status">{props.error()}</p></Show>
    <Show when={props.groups().length > 0} fallback={<p>No associated repositories.</p>}>
      <div class="repo-tools-repositories"><For each={props.groups()}>{(repository) => <section class="repo-tools-group">
        <h2>{repository.name}</h2>
        <Show when={repository.npmInstallNeeded}>
          <InstallControl repository={repository} onInstall={props.onInstall} />
        </Show>
        <For each={[["npm_script", repository.packageScripts], ["make_target", repository.makeTargets]]}>{([kind, names]) =>
          <Show when={names.length > 0}>
            <h3>{kind === 'npm_script' ? 'package.json' : 'Makefile'}</h3>
            <For each={names}>{(name) => <Button type="button" onClick={() => props.onRun(repository, kind, name)}>{name}</Button>}</For>
          </Show>
        }</For>
      </section>}</For></div>
    </Show>
  </ActionMenu>;
}
