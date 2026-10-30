import { createSignal, createUniqueId, onCleanup, onMount, splitProps } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "./Icon.jsx";
import styles from "./Tooltip.module.css";

const SHOW_DELAY = 250;
const HIDE_DELAY = 250;
const EDGE_GAP = 8;

/** A compact, keyboard-accessible help trigger with a non-native tooltip. */
export function Tooltip(props) {
  const [local, rest] = splitProps(props, ["content", "class", "id", "renderTrigger"]);
  const tooltipId = local.id || `tooltip-${createUniqueId()}`;
  const [visible, setVisible] = createSignal(false);
  const [position, setPosition] = createSignal(null);
  let timer, anchor;
  let hovered = false;
  let focused = false;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      show();
    }, SHOW_DELAY);
  };
  const dismiss = () => {
    cancel();
    setVisible(false);
  };
  const scheduleDismiss = () => {
    cancel();
    timer = setTimeout(() => { timer = undefined; setVisible(false); }, HIDE_DELAY);
  };
  const place = () => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const tip = document.getElementById(tooltipId);
    const width = tip?.getBoundingClientRect().width || 240;
    const height = tip?.getBoundingClientRect().height || 40;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(EDGE_GAP, viewportWidth - width - EDGE_GAP);
    const left = Math.max(EDGE_GAP, Math.min(rect.left + rect.width / 2 - width / 2, maxLeft));
    const above = rect.top - height - EDGE_GAP;
    const below = rect.bottom + EDGE_GAP;
    const top = above >= EDGE_GAP
      ? above
      : below + height <= viewportHeight - EDGE_GAP
        ? below
        : (rect.top > viewportHeight - rect.bottom ? above : below);
    setPosition({ top: Math.max(EDGE_GAP, Math.min(top, Math.max(EDGE_GAP, viewportHeight - height - EDGE_GAP))), left });
  };
  const handlers = {
    ref: (element) => {
      anchor = element;
      rest.ref?.(element);
    },
    get "aria-describedby"() {
      const existing = rest["aria-describedby"];
      return visible()
        ? [existing, tooltipId].filter(Boolean).join(" ")
        : existing;
    },
    onMouseEnter: (event) => {
      rest.onMouseEnter?.(event);
      hovered = true;
      cancel();
      schedule();
    },
    onMouseLeave: (event) => {
      rest.onMouseLeave?.(event);
      hovered = false;
      if (!focused) scheduleDismiss();
    },
    onFocus: (event) => {
      rest.onFocus?.(event);
      focused = true;
      schedule();
    },
    onBlur: (event) => {
      rest.onBlur?.(event);
      focused = false;
      if (!hovered) scheduleDismiss();
    },
    onKeyDown: (event) => {
      rest.onKeyDown?.(event);
      if (event.key === "Escape") dismiss();
    },
  };
  onMount(() => {
    const update = () => { if (visible()) place(); };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    onCleanup(() => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); });
  });
  // Measure after the portal has rendered, then keep placement viewport-relative.
  const show = () => {
    setPosition(null);
    setVisible(true);
    (window.requestAnimationFrame || ((callback) => setTimeout(callback, 0)))(place);
  };
  onCleanup(cancel);
  // Invoke custom renderers once during component setup. Calling them from a
  // reactive JSX expression can recreate effects/nodes whenever visibility changes.
  const customTrigger = local.renderTrigger?.(handlers);

  return (
    <span class={`${styles.root} ${local.class || ""}`}>
      {customTrigger
        ? customTrigger
        : (
            <button
              {...rest}
              {...handlers}
              type="button"
              class={styles.trigger}
              aria-label={rest["aria-label"] || "More information"}
            >
              <Icon name="questionMark" />
            </button>
          )}
      {visible() && <Portal><span class={styles.content} style={{ top: `${position()?.top ?? 0}px`, left: `${position()?.left ?? 0}px`, visibility: position() ? "visible" : "hidden" }} role="tooltip" id={tooltipId}>{local.content}</span></Portal>}
    </span>
  );
}
