import { splitProps } from "solid-js";
import { Button } from "./Button.jsx";
import styles from "./IconButton.module.css";

export function IconButton(props) {
  const [local, rest] = splitProps(props, [
    "label",
    "class",
    "className",
    "title",
  ]);
  return (
    <Button
      {...rest}
      class={`${styles.iconButton} ${local.class || local.className || ""}`}
      aria-label={rest["aria-label"] || local.label}
      title={local.title || local.label}
    />
  );
}
