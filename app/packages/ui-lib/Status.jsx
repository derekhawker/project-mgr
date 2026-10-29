import styles from "./controls.module.css";

export function Status(props) {
  return (
    <span
      class={`${styles.status} ${props.class || props.className || ""}`}
      aria-label={props.label}
    >
      {props.children}
    </span>
  );
}
