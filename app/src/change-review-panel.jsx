import { For, Show, createEffect, createSignal } from 'solid-js';
import { Button } from './ui/index.js';
import styles from './work-area.module.css';

function DiffView(props) {
  const text = () => props.file()?.diff || 'No textual differences for this file.';
  const error = () => props.file()?.diffError;
  const left = () => text().split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---') || !line.startsWith('+') && !line.startsWith('@@')).join('\n');
  const right = () => text().split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++') || !line.startsWith('-') && !line.startsWith('@@')).join('\n');
  return <section class="change-review-diff-pane" aria-label="Selected file diff">
    <h2>{props.file()?.path || 'Select a changed file'}</h2>
    <Show when={error()} fallback={props.mode() === 'unified'
      ? <pre class="change-review-unified">{text()}</pre>
      : <div class="change-review-split-container"><pre class="change-review-split">{left()}</pre><pre class="change-review-split">{right()}</pre></div>}>
      <p>{error()}</p>
    </Show>
  </section>;
}

export function ChangeReviewPanel(props) {
  const [selectedFile, setSelectedFile] = createSignal(null);
  createEffect(() => { props.repositories(); setSelectedFile(null); });
  const allFiles = () => (props.repositories() || []).flatMap((repo) => repo.comparisonError ? [] : repo.files);
  const file = () => selectedFile() || allFiles()[0] || null;
  return <section id="change-review-page" class={`change-review-page ${styles.review}`} hidden={!props.visible()} aria-labelledby="change-review-heading">
    <header class="change-review-heading"><div><h1 id="change-review-heading">Change Review</h1><p>Compare with remote main/master, falling back to local main/master · <span data-review-title>{props.summary()}</span></p></div><div class="change-review-actions"><Button id="change-review-back" onClick={props.onBack}>Back to terminals</Button><div class="change-review-mode" role="group" aria-label="Diff presentation"><Button data-review-mode="unified" aria-pressed={props.mode() === 'unified'} onClick={() => props.onMode('unified')}>Unified</Button><Button data-review-mode="split" aria-pressed={props.mode() === 'split'} onClick={() => props.onMode('split')}>Split</Button></div></div></header>
    <div class="change-review-content">
    <aside class="change-review-files" aria-label="Changed files grouped by repository">
      <For each={props.repositories()}>{(repository) => <section class="change-review-repository">
        <h2>{repository.name} ({repository.files.length})</h2>
        <p class="change-review-repo-path">{repository.path}</p>
        <p class="change-review-target">Compare with: {repository.comparisonTarget || 'no origin or local main/master (unavailable)'}</p>
        <Show when={repository.comparisonError}><p class="change-review-error">{repository.comparisonError}</p></Show>
        <ul><Show when={repository.files.length > 0} fallback={<li>{repository.comparisonError
          ? 'No working-tree changes to list. Comparison diff is unavailable.'
          : 'No changed files against the selected comparison branch or in the working tree.'}</li>}>
          <For each={repository.files}>{(entry) => <li><button type="button"
            aria-current={file() === entry ? 'true' : undefined}
            onClick={() => setSelectedFile(entry)}>{entry.path} · {entry.status}</button></li>}</For>
        </Show></ul>
      </section>}</For>
      <Show when={!props.repositories().length}><p>{props.error() || 'This workspace has no repositories to review.'}</p></Show>
    </aside>
    <DiffView file={file} mode={props.mode} />
    </div>
  </section>;
}
