import styles from "./ActionMenu.module.css";
import controlStyles from "./controls.module.css";
import { useDismissableLayer } from "./dismissableLayer.js";
import { MenuSurface } from "./MenuSurface.jsx";
import { Icon } from "./Icon.jsx";

/** A native disclosure; direction="up" reverses placement and the chevron. */
export function ActionMenu(props) {
  let menu;
  const close = () => {
    if (props.open !== undefined) props.onRequestClose?.();
    else if (menu) menu.open = false;
  };
  useDismissableLayer({
    isOpen: () => !!menu?.open,
    contains: (target) => menu?.contains(target),
    close,
    focusTrigger: () => menu?.querySelector("summary")?.focus(),
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
      }}
      class={className()}
      data-direction={props.direction === "up" ? "up" : "down"}
      hidden={props.hidden}
      open={props.open ?? props.defaultOpen}
      onToggle={(event) => {
        if (props.open === undefined)
          props.onToggle?.(event.currentTarget.open);
      }}
    >
      <summary
        id={props.triggerId}
        class={triggerClassName()}
        aria-label={props.label}
        aria-disabled={props.disabled ? "true" : undefined}
        aria-expanded={
          props.open === undefined ? undefined : String(props.open)
        }
        aria-controls={props.contentId}
        tabIndex={props.disabled ? -1 : undefined}
        onClick={(event) => {
          if (props.disabled || props.open !== undefined)
            event.preventDefault();
          if (!props.disabled && props.open !== undefined)
            props.onRequestToggle?.();
        }}
      >
        <Icon name="chevron" class={styles.indicator} muted />
        {props.label}
      </summary>
      <MenuSurface
        id={props.contentId}
        surfaceVariant={props.surfaceVariant ?? "accent"}
        class={`${styles.actions} ${props.contentClass || ""}`}
        role="group"
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
    </details>
  );
}
