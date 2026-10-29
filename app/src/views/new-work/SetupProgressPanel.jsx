import { SetupProgressList } from "./SetupProgressList.jsx";
import styles from "./SetupProgressPanel.module.css";

export function SetupProgressPanel(props) {
  return (
    <section
      id="new-work-progress"
      class={styles.progress}
      hidden={!props.visible()}
      aria-label="Setup progress"
      aria-live="polite"
    >
      <h2>Progress</h2>
      <ol id="new-work-progress-steps">
        <SetupProgressList rows={props.rows} />
      </ol>
    </section>
  );
}
