import { createEffect, createSignal, createUniqueId, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import styles from "./ActionMenu.module.css";
import controlStyles from "./controls.module.css";
import { useDismissableLayer } from "./dismissableLayer.js";
import { MenuSurface } from "./MenuSurface.jsx";
import { Icon } from "./Icon.jsx";

/** A native disclosure; direction="up" reverses placement and the chevron. */
export function ActionMenu(props) {
  let menu;
  let surface;
  let popupDialog;
  let selectionSurface;
  let popupRegistered = false;
  let usesPopover = false;
  let layoutObserver;
  let sizeObserver;
  let repositionFrame;
  const generatedContentId = `action-menu-${createUniqueId()}`;
  const contentId = () => props.contentId ?? (props.portal ? generatedContentId : undefined);
  const [portalTarget, setPortalTarget] = createSignal(null);
  const [portalStyle, setPortalStyle] = createSignal({});
  const [portalOpen, setPortalOpen] = createSignal(false);
  const [disclosureOpen, setDisclosureOpen] = createSignal(
    Boolean(props.defaultOpen),
  );
  const controlled = props.open !== undefined;
  const isOpen = () =>
    typeof props.open === "function" ? props.open() : props.open;
  createEffect(() => {
    if (controlled && menu) menu.open = Boolean(isOpen());
  });
  const positionPortal = () => {
    if (!props.portal || !menu?.open || !surface) return;
    const trigger = menu.querySelector("summary");
    const dialog = menu.closest("dialog");
    if (!trigger) return;
    const anchor = trigger.getBoundingClientRect();
    const frame = dialog?.getBoundingClientRect();
    const fixed = usesPopover || !frame;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const below = (fixed ? viewportHeight : frame.bottom) - anchor.bottom;
    const above = anchor.top - (fixed ? 0 : frame.top);
    const optionCount = surface.querySelectorAll("button, a").length;
    const desired = Math.min(360, Math.max(72, optionCount * 36));
    const openDown = below >= desired || (above < desired && below >= above);
    const available = Math.max(1, (openDown ? below : above) - 8);
    setPortalStyle({
      position: fixed ? "fixed" : "absolute",
      left: `${fixed ? Math.max(0, Math.min(anchor.left, window.innerWidth - surface.offsetWidth)) : anchor.left - frame.left}px`,
      width: "auto",
      maxHeight: `${Math.min(360, available)}px`,
      top: openDown
        ? `${fixed ? anchor.bottom : anchor.bottom - frame.top}px`
        : undefined,
      bottom: openDown
        ? undefined
        : `${fixed ? viewportHeight - anchor.top : frame.bottom - anchor.top}px`,
    });
  };
  const stopTrackingLayout = () => {
    layoutObserver?.disconnect();
    sizeObserver?.disconnect();
    if (repositionFrame) cancelAnimationFrame(repositionFrame);
    repositionFrame = undefined;
  };
  const trackLayout = () => {
    stopTrackingLayout();
    if (!props.portal || !menu?.open) return;
    const schedule = () => {
      if (repositionFrame) return;
      repositionFrame = requestAnimationFrame(() => {
        repositionFrame = undefined;
        positionPortal();
      });
    };
    // Watch the nearest scrolling region (or the parent), not the whole app.
    // Row moves and text changes can move the anchor without resizing it.
    let root = menu.parentElement;
    while (root && root !== document.body &&
      !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    if (!root || root === document.body) root = menu.parentElement;
    if (root && typeof MutationObserver !== "undefined") {
      layoutObserver = new MutationObserver(schedule);
      layoutObserver.observe(root, { childList: true, characterData: true, subtree: true });
    }
    if (typeof window.ResizeObserver !== "undefined") {
      sizeObserver = new window.ResizeObserver(schedule);
      sizeObserver.observe(menu);
      if (root) sizeObserver.observe(root);
      if (surface) sizeObserver.observe(surface);
    }
  };
  const focusable = (root) => Array.from(root.querySelectorAll(
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.disabled && element.tabIndex >= 0 &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length);
  const handlePortalTab = (event) => {
    if (event.defaultPrevented || !props.portal || !menu?.open || event.key !== "Tab" || !surface) return;
    const trigger = menu.querySelector("summary");
    const items = focusable(surface);
    const active = document.activeElement;
    if (!event.shiftKey && active === trigger && items.length) {
      event.preventDefault();
      items[0].focus();
    } else if (event.shiftKey && active === items[0]) {
      event.preventDefault();
      trigger.focus();
    } else if (!event.shiftKey && active === items.at(-1)) {
      const scope = menu.closest("dialog") || document;
      const order = focusable(scope).filter((element) => !surface.contains(element));
      const next = order[order.indexOf(trigger) + 1];
      if (next) {
        event.preventDefault();
        next.focus();
      }
    } else if (event.shiftKey && items.length) {
      const scope = menu.closest("dialog") || document;
      const order = focusable(scope).filter((element) => !surface.contains(element));
      if (active === order[order.indexOf(trigger) + 1]) {
        event.preventDefault();
        items.at(-1).focus();
      }
    }
  };
  const syncPopover = (open) => {
    if (!surface || typeof surface.showPopover !== "function") return false;
    usesPopover = true;
    if (open) {
      queueMicrotask(() => {
        positionPortal();
        if (!surface.matches(":popover-open")) {
          try {
            surface.showPopover();
            positionPortal();
          } catch {
            usesPopover = false;
            syncDialogPopup(true);
            positionPortal();
          }
        }
      });
    } else if (surface.matches(":popover-open")) {
      surface.hidePopover();
    }
    return true;
  };
  const close = () => {
    if (controlled) {
      if (menu) menu.open = false;
      props.onRequestClose?.();
    } else if (menu) menu.open = false;
  };
  createEffect(() => {
    if (props.disabled && menu?.open) close();
  });
  const closeOnSelection = (event) => {
    const action = event.target.closest?.("button, a");
    if (
      props.closeOnSelect !== false &&
      action &&
      surface?.contains(action) &&
      !action.disabled &&
      action.getAttribute("aria-disabled") !== "true"
    ) {
      const restoreFocus = document.activeElement === action;
      close();
      // Let the selected action run first. Restore only if it kept focus on
      // itself; an action that deliberately moved focus owns that decision.
      if (restoreFocus) queueMicrotask(() => {
        if (document.activeElement === action)
          menu?.querySelector("summary")?.focus();
      });
    }
  };
  const attachSurface = (element) => {
    if (selectionSurface) {
      selectionSurface.removeEventListener("click", closeOnSelection);
    }
    surface = element;
    selectionSurface = element;
    selectionSurface?.addEventListener("click", closeOnSelection);
  };
  const releaseDialogPopup = () => {
    if (!popupRegistered || !popupDialog) return;
    const count = Math.max(0, Number(popupDialog.dataset.uiPopupCount || 0) - 1);
    if (count) popupDialog.dataset.uiPopupCount = String(count);
    else {
      delete popupDialog.dataset.uiPopupCount;
      popupDialog.removeAttribute("data-ui-popup-open");
    }
    popupRegistered = false;
    popupDialog = null;
  };
  const syncDialogPopup = (open) => {
    const dialog = menu?.closest("dialog");
    if (!dialog) return;
    if (open && !popupRegistered) {
      popupDialog = dialog;
      popupRegistered = true;
      dialog.dataset.uiPopupCount = String(
        Number(dialog.dataset.uiPopupCount || 0) + 1,
      );
      dialog.setAttribute("data-ui-popup-open", "");
    } else if (!open) releaseDialogPopup();
  };
  useDismissableLayer({
    isOpen: () => !!menu?.open,
    contains: (target) => menu?.contains(target) || surface?.contains(target),
    close,
    focusTrigger: () => menu?.querySelector("summary")?.focus(),
  });
  onMount(() => {
    const reposition = () => positionPortal();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", handlePortalTab);
    onCleanup(() => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
      document.removeEventListener("keydown", handlePortalTab);
    });
  });
  onCleanup(() => {
    selectionSurface?.removeEventListener("click", closeOnSelection);
    stopTrackingLayout();
    releaseDialogPopup();
  });
  const className = () => [styles.menu, props.class].filter(Boolean).join(" ");
  const triggerClassName = () =>
    [
      controlStyles.control,
      controlStyles[props.triggerVariant || "default"],
      styles.trigger,
      props.triggerClass,
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <details
      ref={(element) => {
        menu = element;
        if (props.portal)
          queueMicrotask(() => {
            if (menu === element) {
              const dialog = element?.closest("dialog");
              setPortalTarget(dialog || document.body);
            }
          });
      }}
      class={className()}
      data-direction={props.direction === "up" ? "up" : "down"}
      hidden={props.hidden}
      open={controlled ? isOpen() : props.defaultOpen}
      onToggle={(event) => {
        setDisclosureOpen(event.currentTarget.open);
        setPortalOpen(event.currentTarget.open);
        if (props.portal) {
          const hasPopover = syncPopover(event.currentTarget.open);
          if (hasPopover) releaseDialogPopup();
          else syncDialogPopup(event.currentTarget.open);
          if (event.currentTarget.open) trackLayout();
          else stopTrackingLayout();
        }
        if (event.currentTarget.open) queueMicrotask(positionPortal);
        if (!controlled)
          props.onToggle?.(event.currentTarget.open);
      }}
    >
      <summary
        {...props.triggerProps}
        id={props.triggerId}
        class={triggerClassName()}
        aria-label={props.label}
        aria-disabled={props.disabled ? "true" : undefined}
        aria-expanded={
          !controlled
            ? String(disclosureOpen())
            : String(isOpen())
        }
        aria-controls={contentId()}
        role={props.triggerRole}
        aria-haspopup={props.triggerHasPopup}
        aria-labelledby={props.triggerLabelledBy}
        aria-describedby={props.triggerDescribedBy}
        aria-busy={props.triggerBusy}
        tabIndex={props.disabled ? -1 : undefined}
        onClick={(event) => {
          if (props.disabled || controlled)
            event.preventDefault();
          if (!props.disabled && controlled)
            props.onRequestToggle?.();
        }}
      >
        {props.triggerText ?? props.label}
        <Icon name="chevron" class={styles.indicator} muted />
      </summary>
      {props.portal ? (
        <Show when={portalTarget()}>
          {(target) => (
            <Portal mount={target()}>
              <MenuSurface
                ref={(element) => {
                  attachSurface(element);
                  queueMicrotask(positionPortal);
                }}
                style={portalStyle()}
                hidden={!portalOpen()}
                popover="manual"
                id={contentId()}
                surfaceVariant={props.surfaceVariant ?? "accent"}
                class={`${styles.actions} ${styles.portalActions} ${props.contentClass || ""}`}
                role={props.contentRole ?? "group"}
                aria-label={props.actionsLabel ?? props.label}
              >
                {props.children}
              </MenuSurface>
            </Portal>
          )}
        </Show>
      ) : (
        <MenuSurface
          ref={attachSurface}
          id={props.contentId}
          surfaceVariant={props.surfaceVariant ?? "accent"}
          class={`${styles.actions} ${props.contentClass || ""}`}
          role={props.contentRole ?? "group"}
          aria-label={props.actionsLabel ?? props.label}
        >
          {props.children}
        </MenuSurface>
      )}
    </details>
  );
}
