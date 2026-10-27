import { Button, Input } from './ui/index.js';
import styles from './directories.module.css';

export function DirectoriesLibraryForm(props) {
  return (
    <>
      <div class={styles.heading}><h1 id="directories-title">Directories</h1><Button id="add-repository-directories" variant="primary" disabled={props.addingDirectories()} onClick={props.onAddDirectories}>Add directories</Button></div>
      <form id="repository-library-form" class={styles.form} onSubmit={props.onSave}>
        <label for="repository-library-path">Repository library location</label>
        <div class={styles.formRow}><Input id="repository-library-path" type="text" required autocomplete="off" value={props.path()} onInput={(event) => props.onPathInput(event.currentTarget.value)} /><Button id="choose-repository-library" onClick={props.onChoose}>Choose folder</Button><Button type="submit" variant="primary" disabled={props.saving()}>Save location</Button></div>
        <p id="repository-library-status" role="status" aria-live="polite">{props.status()}</p>
      </form>
    </>
  );
}
