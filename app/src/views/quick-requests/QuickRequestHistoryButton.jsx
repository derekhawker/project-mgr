import { Icon, IconButton } from "@ui-lib";
import styles from "./QuickRequestHistoryButton.module.css";

export function QuickRequestHistoryButton(props) {
  return (
    <IconButton
      id="show-history"
      label="Open all Quick Requests"
      onClick={props.onShow}
    >
      <Icon name="chevron" muted class={styles.chevron} />
    </IconButton>
  );
}
