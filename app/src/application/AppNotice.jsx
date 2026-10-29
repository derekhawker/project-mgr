import styles from "./AppNotice.module.css";

export function AppNotice(props) {
  return (
    <p
      id="app-notice"
      class={styles.notice}
      role="status"
      aria-live="polite"
      hidden={!props.message()}
    >
      {props.message()}
    </p>
  );
}
