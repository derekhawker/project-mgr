import { Button, ErrorMessage, Input } from "@ui-lib";
import { PageError } from "../../components/PageError.jsx";
import styles from "./directories.module.css";

export function DirectoriesLibraryForm(props) {
  return (
    <>
      <div class={styles.pageActions}>
        <Button
          id="add-repository-directories"
          variant="primary"
          disabled={props.addingDirectories()}
          onClick={props.onAddDirectories}
        >
          Add directories
        </Button>
      </div>
      <PageError message={props.pageError} />
      <div id="repository-library-form" class={styles.form}>
        <label for="repository-library-path">Repository library location</label>
        <div class={styles.formRow}>
          <Input
            id="repository-library-path"
            type="text"
            required
            autocomplete="off"
            value={props.path()}
            onInput={(event) => props.onPathInput(event.currentTarget.value)}
            onBlur={props.onSave}
          />
          <Button id="choose-repository-library" onClick={props.onChoose}>
            Choose folder
          </Button>
        </div>
        <ErrorMessage
          id="repository-library-error"
          placement="inline"
          message={props.error}
        />
        <p id="repository-library-status" role="status" aria-live="polite">
          {props.status()}
        </p>
      </div>
    </>
  );
}
