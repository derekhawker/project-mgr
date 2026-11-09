import { Icon, IconButton } from "@ui-lib";
import styles from "./WorkspaceTicketViewToggle.module.css";

export function WorkspaceTicketViewToggle(props) {
  return (
    <IconButton
      class={styles.toggle}
      label={
        props.viewMode() === "grouped"
          ? "Show flat ticket list"
          : "Group tickets by Workspace"
      }
      aria-pressed={String(props.viewMode() === "flat")}
      onClick={props.onToggle}
    >
      <Icon name={props.viewMode() === "grouped" ? "list" : "folderOpen"} />
    </IconButton>
  );
}
