import { splitProps } from "solid-js";
import { Button } from "@ui-lib";
import styles from "./NavigationItem.module.css";

/** A full-width selectable destination row for persistent app navigation. */
export function NavigationItem(props) {
  const [local, rest] = splitProps(props, ["children", "current", "class"]);
  return (
    <Button
      {...rest}
      aria-current={local.current ? "page" : undefined}
      class={`${styles.item} ${local.class || ""}`}
    >
      {local.children}
    </Button>
  );
}
