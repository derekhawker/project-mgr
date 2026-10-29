import { splitProps } from "solid-js";
import styles from "./ActionMenuItem.module.css";

/** A flat menu row with native button focus, activation, and disabled behavior. */
export function ActionMenuItem(props) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <button
      type="button"
      {...rest}
      class={`${styles.item} ${local.class || ""}`}
    >
      {local.children}
    </button>
  );
}
