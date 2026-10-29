import {
  createEffect,
  createUniqueId,
  onCleanup,
  onMount,
  Show,
  splitProps,
} from "solid-js";
import { IconButton } from "./IconButton.jsx";
import { Icon } from "./Icon.jsx";
import styles from "./Modal.module.css";

/** Native modal frame. Controlled open or an imperative ref; caller-owned closure. */
export function Modal(props) {
  const [local, rest] = splitProps(props, [
    "open",
    "ref",
    "title",
    "titleId",
    "closeLabel",
    "onCloseRequest",
    "children",
    "footer",
    "size",
    "class",
    "aria-label",
    "aria-labelledby",
  ]);
  let dialog;
  let returnFocus;
  let awaitingClose = false;
  const titleId = `ui-modal-title-${createUniqueId()}`;

  onMount(() => {
    if (
      import.meta.env.DEV &&
      !props.title &&
      !props["aria-label"] &&
      !props["aria-labelledby"]
    ) {
      console.warn("Modal requires a title, aria-label, or aria-labelledby.");
    }
    const rememberFocus = () => {
      const active = document.activeElement;
      // A disclosure action is hidden once its menu closes; return to its trigger.
      returnFocus =
        active?.closest("details")?.querySelector("summary") || active;
    };
    const restoreFocus = () => {
      if (!dialog.open && returnFocus?.isConnected)
        returnFocus.focus({ preventScroll: true });
      if (!dialog.open) awaitingClose = false;
    };
    const beforeToggle = (event) => {
      if (event.newState === "open") {
        rememberFocus();
        awaitingClose = true;
      }
    };
    const outsideFocus = () => {
      // Native close restores focus before its asynchronous close event. Do not
      // let that intermediate focus overwrite the remembered disclosure trigger.
      if (dialog.open) awaitingClose = true;
      else if (!awaitingClose && !dialog.contains(document.activeElement))
        rememberFocus();
    };
    rememberFocus();
    dialog.addEventListener("beforetoggle", beforeToggle);
    document.addEventListener("focusin", outsideFocus);
    dialog.addEventListener("close", restoreFocus);
    const sync = () => {
      if (local.open === undefined) return;
      if (local.open && !dialog.open) {
        rememberFocus();
        dialog.showModal();
      } else if (!local.open && dialog.open) dialog.close();
    };
    createEffect(sync);
    onCleanup(() => {
      if (dialog.open) dialog.close();
      dialog.removeEventListener("close", restoreFocus);
      dialog.removeEventListener("beforetoggle", beforeToggle);
      document.removeEventListener("focusin", outsideFocus);
    });
  });

  const requestClose = (event) => {
    event?.preventDefault();
    local.onCloseRequest?.();
  };

  const containTab = (event) => {
    rest.onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Tab") return;
    const controls = [
      ...dialog.querySelectorAll(
        "button, input, select, textarea, a[href], summary, [tabindex]",
      ),
    ].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        !element.closest("[inert]") &&
        element.getClientRects().length &&
        getComputedStyle(element).visibility !== "hidden",
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      {...rest}
      ref={(element) => {
        dialog = element;
        local.ref?.(element);
      }}
      class={`${styles.modal} ${local.size === "wide" ? styles.wide : ""} ${local.class || ""}`}
      aria-label={props.title ? undefined : props["aria-label"]}
      aria-labelledby={
        props.title ? props.titleId || titleId : props["aria-labelledby"]
      }
      onCancel={requestClose}
      onKeyDown={containTab}
    >
      <header class={styles.header}>
        {local.title && (
          <h2 id={local.titleId || titleId} class={styles.title}>
            {local.title}
          </h2>
        )}
        <IconButton
          type="button"
          class={styles.close}
          onClick={requestClose}
          label={local.closeLabel || "Close dialog"}
        >
          <Icon name="close" />
        </IconButton>
      </header>
      <div class={styles.body} data-modal-body>
        {local.children}
      </div>
      <Show when={local.footer}>
        {(footer) => <footer class={styles.footer}>{footer()}</footer>}
      </Show>
    </dialog>
  );
}
