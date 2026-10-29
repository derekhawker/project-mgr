import { Show, splitProps } from "solid-js";
import styles from "./ErrorMessage.module.css";

export function ErrorMessage(props) {
  const [local, rest] = splitProps(props, [
    "message",
    "placement",
    "class",
    "className",
  ]);
  const message = () =>
    typeof local.message === "function" ? local.message() : local.message;
  return (
    <Show when={message()}>
      <div
        {...rest}
        class={`${styles.error} ${styles[local.placement || "inline"] || styles.inline} ${local.class || local.className || ""}`}
        role="alert"
        aria-live="assertive"
      >
        {message()}
      </div>
    </Show>
  );
}
