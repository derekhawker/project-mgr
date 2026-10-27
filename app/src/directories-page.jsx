import { Button } from './ui/index.js';
import styles from './directories.module.css';

export function DirectoriesPage(props) {
  return (
    <section id="directories-page" class={styles.page} hidden={!props.visible()} aria-labelledby="directories-title">
      <div id="directories-library-form-root"></div>
      <p id="repository-status" role="status" aria-live="polite">{props.status()}</p>
      <section class={styles.archives} aria-labelledby="legacy-archives-title">
        <h2 id="legacy-archives-title">Archived legacy records</h2>
        <p>Restore an archived Task's database associations if you need to recover its historical record. Its files and OpenCode history are not changed.</p>
        <ul id="legacy-task-archives" aria-label="Archived legacy Task records"><li>Loading…</li></ul>
      </section>
      <ul id="directory-list" class={styles.directoryList} aria-label="Repositories grouped by directory"></ul>
      <Button id="directories-back" onClick={props.onBack}>Back</Button>
    </section>
  );
}
