import styles from "./WorkspaceTag.module.css";

export function WorkspaceTag(props) {
  return (
    <span
      class={styles.tag}
      style={{
        "--ticket-label-color": `var(--ticket-label-${props.colorIndex})`,
      }}
      title={props.label}
      aria-label={props.label}
    >
      {props.label}
    </span>
  );
}
