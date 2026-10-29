import { splitProps } from "solid-js";
import styles from "./ActionMenu.module.css";

export function MenuSurface(props) {
  const [local, rest] = splitProps(props, [
    "class",
    "children",
    "surfaceVariant",
  ]);
  return (
    <div
      {...rest}
      data-surface-variant={local.surfaceVariant}
      class={`${styles.surface} ${local.class || ""}`}
    >
      {local.children}
    </div>
  );
}
