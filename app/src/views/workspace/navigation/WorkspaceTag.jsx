import { Button } from "@ui-lib";
import styles from "./WorkspaceTag.module.css";

export function WorkspaceTag(props) {
  return (
    <Button
      class={styles.tag}
      style={{
        "--ticket-label-color": `var(--ticket-label-${props.colorIndex})`,
      }}
      title={props.label}
      aria-label={`${props.label}; open ${props.workspaceName} ticket browser`}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}
