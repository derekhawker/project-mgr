import { splitProps } from "solid-js";
import styles from "./controls.module.css";

export function TextArea(props) {
  const [local, rest] = splitProps(props, ["class", "className"]);
  return (
    <textarea
      {...rest}
      class={`${styles.field} ${styles.textarea} ${local.class || local.className || ""}`}
    />
  );
}
