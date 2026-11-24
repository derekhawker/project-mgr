import styles from "./AppNotice.module.css";
import { Button } from "@ui-lib";

export function AppNotice(props) {
  return (
    <div
      id="app-notice"
      class={styles.notice}
      role="status"
      aria-live="polite"
      hidden={!props.message()}
    >
      <span>{props.message()}</span>
      <Button type="button" variant="ghost" onClick={props.onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
