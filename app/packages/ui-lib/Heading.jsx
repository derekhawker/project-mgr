import { splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";
import styles from "./Heading.module.css";

export function Heading(props) {
  const [local, rest] = splitProps(props, [
    "level",
    "size",
    "class",
    "className",
    "children",
  ]);
  const level = () => Math.min(6, Math.max(1, Number(local.level) || 2));
  const size = () => styles[local.size || "section"] || styles.section;
  return (
    <Dynamic
      component={`h${level()}`}
      {...rest}
      class={`${styles.heading} ${size()} ${local.class || local.className || ""}`}
    >
      {local.children}
    </Dynamic>
  );
}
