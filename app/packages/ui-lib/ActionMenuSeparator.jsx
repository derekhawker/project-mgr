import { splitProps } from "solid-js";
import styles from "./ActionMenuSeparator.module.css";

/** A non-focusable semantic divider between menu sections. */
export function ActionMenuSeparator(props) {
  const [local, rest] = splitProps(props, ["class"]);
  return <hr {...rest} class={`${styles.separator} ${local.class || ""}`} />;
}
