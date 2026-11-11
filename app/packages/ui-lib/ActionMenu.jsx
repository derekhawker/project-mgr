import { createSignal, onCleanup, onMount, Show } from "solid-js";
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
  let popupRegistered = false;
  let usesPopover = false;
  const [portalTarget, setPortalTarget] = createSignal(null);
  const [portalInDialog, setPortalInDialog] = createSignal(false);
  const [portalStyle, setPortalStyle] = createSignal({});
  const [portalOpen, setPortalOpen] = createSignal(false);
  const [disclosureOpen, setDisclosureOpen] = createSignal(
    Boolean(props.defaultOpen),
  );
  const positionPortal = () => {
    if (!props.portal || !menu?.open || !surface) return;
    const trigger = menu.querySelector("summary");
    const dialog = menu.closest("dialog");
    if (!trigger || !dialog) return;
    const anchor = trigger.getBoundingClientRect();
    const frame = dialog.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const below = (usesPopover ? viewportHeight : frame.bottom) - anchor.bottom;
    const above = anchor.top - (usesPopover ? 0 : frame.top);
    const optionCount = surface.querySelectorAll("button, a").length;
    const desired = Math.min(360, Math.max(72, optionCount * 36));
    const openDown = below >= desired || (above < desired && below >= above);
    const available = Math.max(1, (openDown ? below : above) - 8);
    setPortalStyle({
      position: usesPopover ? "fixed" : "absolute",
      left: `${usesPopover ? anchor.left : anchor.left - frame.left}px`,
      width: "auto",
      maxHeight: `${Math.min(360, available)}px`,
      top: openDown
        ? `${usesPopover ? anchor.bottom : anchor.bottom - frame.top}px`
        : undefined,
      bottom: openDown
        ? undefined
        : `${usesPopover ? viewportHeight - anchor.top : frame.bottom - anchor.top}px`,
    });
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
    if (props.open !== undefined) props.onRequestClose?.();
    else if (menu) menu.open = false;
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
    onCleanup(() => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    });
  });
  onCleanup(releaseDialogPopup);
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
              setPortalTarget(dialog || null);
              setPortalInDialog(Boolean(dialog));
            }
          });
      }}
      class={className()}
      data-direction={props.direction === "up" ? "up" : "down"}
      hidden={props.hidden}
      open={props.open ?? props.defaultOpen}
      onToggle={(event) => {
        setDisclosureOpen(event.currentTarget.open);
        setPortalOpen(event.currentTarget.open);
        if (props.portal) {
          const hasPopover = syncPopover(event.currentTarget.open);
          if (hasPopover) releaseDialogPopup();
          else syncDialogPopup(event.currentTarget.open);
        }
        if (event.currentTarget.open) queueMicrotask(positionPortal);
        if (props.open === undefined)
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
          props.open === undefined
            ? String(disclosureOpen())
            : String(props.open)
        }
        aria-controls={props.contentId}
        role={props.triggerRole}
        aria-haspopup={props.triggerHasPopup}
        aria-labelledby={props.triggerLabelledBy}
        aria-describedby={props.triggerDescribedBy}
        aria-busy={props.triggerBusy}
        tabIndex={props.disabled ? -1 : undefined}
        onClick={(event) => {
          if (props.disabled || props.open !== undefined)
            event.preventDefault();
          if (!props.disabled && props.open !== undefined)
            props.onRequestToggle?.();
        }}
      >
        {props.triggerText ?? props.label}
        <Icon name="chevron" class={styles.indicator} muted />
      </summary>
      {props.portal && portalInDialog() ? (
        <Show when={portalTarget()}>
          {(target) => (
            <Portal mount={target()}>
              <MenuSurface
                ref={(element) => {
                  surface = element;
                  queueMicrotask(positionPortal);
                }}
                style={portalStyle()}
                hidden={!portalOpen()}
                popover="manual"
                id={props.contentId}
                surfaceVariant={props.surfaceVariant ?? "accent"}
                class={`${styles.actions} ${styles.portalActions} ${props.contentClass || ""}`}
                role={props.contentRole ?? "group"}
                aria-label={props.actionsLabel ?? props.label}
                onClick={(event) => {
                  const action = event.target.closest("button, a");
                  if (
                    props.closeOnSelect !== false &&
                    action &&
                    event.currentTarget.contains(action) &&
                    !action.disabled &&
                    action.getAttribute("aria-disabled") !== "true"
                  )
                    close();
                }}
              >
                {props.children}
              </MenuSurface>
            </Portal>
          )}
        </Show>
      ) : (
        <MenuSurface
          ref={(element) => {
            surface = element;
          }}
          id={props.contentId}
          surfaceVariant={props.surfaceVariant ?? "accent"}
          class={`${styles.actions} ${props.contentClass || ""}`}
          role={props.contentRole ?? "group"}
          aria-label={props.actionsLabel ?? props.label}
          onClick={(event) => {
            const action = event.target.closest("button, a");
            if (
              props.closeOnSelect !== false &&
              action &&
              event.currentTarget.contains(action) &&
              !action.disabled &&
              action.getAttribute("aria-disabled") !== "true"
            )
              close();
          }}
        >
          {props.children}
        </MenuSurface>
      )}
    </details>
  );
}
