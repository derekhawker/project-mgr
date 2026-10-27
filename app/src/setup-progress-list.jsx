import { For } from 'solid-js';

export function SetupProgressPanel(props) {
  return <section id="new-work-progress" class="new-work-progress" hidden={!props.visible()} aria-label="Setup progress" aria-live="polite">
    <h2>Progress</h2><ol id="new-work-progress-steps"><SetupProgressList rows={props.rows} /></ol>
  </section>;
}

export function SetupProgressList(props) {
  return <For each={[...props.rows().values()]}>{(row) =>
    <li data-status={row.status}>
      <span>{row.label} — {row.status === 'running' ? 'in progress' : row.status === 'skipped' ? 'not run' : row.status}</span>
      <details hidden={!row.detail}><summary>Details</summary><pre>{row.detail || ''}</pre></details>
    </li>
  }</For>;
}
