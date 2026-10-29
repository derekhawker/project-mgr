import { splitProps } from "solid-js";
import styles from "./controls.module.css";

export function Button(props) {
  const [local, rest] = splitProps(props, [
    "variant",
    "class",
    "className",
    "children",
  ]);
  return (
    <button
      type="button"
      {...rest}
      class={`${styles.control} ${styles.button} ${styles[local.variant || "default"] || ""} ${local.class || local.className || ""}`}
    >
      {local.children}
    </button>
  );
}
