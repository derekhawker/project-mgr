import styles from "./directories.module.css";

export function DirectoriesPage(props) {
  return (
    <section
      id="directories-page"
      class={styles.page}
      hidden={!props.visible()}
      aria-labelledby="directories-title"
    >
      {props.libraryForm?.()}
      <p id="repository-status" role="status" aria-live="polite">
        {props.status()}
      </p>
      {props.repositoryDirectories?.() ?? (
        <ul
          id="directory-list"
          class={styles.directoryList}
          aria-label="Repositories grouped by directory"
        />
      )}
    </section>
  );
}
