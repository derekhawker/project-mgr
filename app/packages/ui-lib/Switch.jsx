import { splitProps } from "solid-js";
import styles from "./Switch.module.css";

/** A native checkbox styled as a binary switch. Pair it with a visible label. */
export function Switch(props) {
  const [local, rest] = splitProps(props, ["class", "className"]);
  return (
    <input
      {...rest}
      type="checkbox"
      role="switch"
      class={`${styles.switch} ${local.class || local.className || ""}`}
    />
  );
}
