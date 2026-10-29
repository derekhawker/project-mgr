import { splitProps, Show } from "solid-js";
import styles from "./controls.module.css";

export function Notice(props) {
  const [local, rest] = splitProps(props, [
    "children",
    "message",
    "status",
    "class",
    "className",
  ]);
  const content = () => local.children ?? local.message;
  return (
    <Show when={content()}>
      <div
        class={`${styles.notice} ${styles[local.status || "info"] || ""} ${local.class || local.className || ""}`}
        role="status"
        aria-live="polite"
        {...rest}
      >
        {content()}
      </div>
    </Show>
  );
}
