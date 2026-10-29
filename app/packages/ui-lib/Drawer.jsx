import { createEffect, createUniqueId, onCleanup, onMount } from "solid-js";
import styles from "./overlay.module.css";

/** Controlled edge drawer rendered as a modal overlay. */
export function Drawer(props) {
  let dialog;
  const titleId = `ui-drawer-title-${createUniqueId()}`;
  onMount(() => {
    if (
      import.meta.env.DEV &&
      !props.title &&
      !props["aria-label"] &&
      !props["aria-labelledby"]
    ) {
      console.warn("Drawer requires a title, aria-label, or aria-labelledby.");
    }
    const sync = () => {
      if (props.open && !dialog.open) dialog.showModal();
      else if (!props.open && dialog.open) dialog.close();
    };
    createEffect(sync);
    onCleanup(() => {
      if (dialog.open) dialog.close();
    });
  });

  const requestClose = (event) => {
    event?.preventDefault();
    props.onCloseRequest?.();
  };

  return (
    <dialog
      ref={dialog}
      class={`${styles.drawer} ${styles[props.side || "right"]}`}
      aria-label={props.title ? undefined : props["aria-label"]}
      aria-labelledby={
        props.title ? props.titleId || titleId : props["aria-labelledby"]
      }
      onCancel={requestClose}
    >
      {props.title && (
        <h2 id={props.titleId || titleId} class={styles.title}>
          {props.title}
        </h2>
      )}
      <button
        type="button"
        class={styles.close}
        onClick={requestClose}
        aria-label={props.closeLabel || "Close drawer"}
      >
        {props.closeLabel || "Close"}
      </button>
      {props.children}
    </dialog>
  );
}
