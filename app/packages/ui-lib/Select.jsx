import { splitProps } from "solid-js";
import styles from "./controls.module.css";

export function Select(props) {
  const [local, rest] = splitProps(props, ["class", "className", "children"]);
  return (
    <select
      {...rest}
      class={`${styles.field} ${styles.select} ${local.class || local.className || ""}`}
    >
      {local.children}
    </select>
  );
}
