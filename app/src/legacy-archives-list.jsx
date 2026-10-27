import { For, Show } from 'solid-js';
import { Button } from './ui/index.js';

export function LegacyArchivesList(props) {
  return <Show when={!props.error()} fallback={<li>{props.error()}</li>}>
    <Show when={props.records().length > 0} fallback={<li>No archived legacy records.</li>}>
      <For each={props.records()}>{(archive) => <li>
      <span>{archive.taskId} · Workspace {archive.workspaceId} · archived {new Date(archive.archivedAt).toLocaleString()}</span>
      <Button disabled={Boolean(archive.restoredAt) || props.isRestoring(archive.taskId)}
        onClick={() => props.onRestore(archive)}>{archive.restoredAt ? 'Restored' : 'Restore record'}</Button>
      </li>}</For>
    </Show>
  </Show>;
}
