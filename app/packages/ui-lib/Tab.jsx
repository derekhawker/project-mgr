import {
  Show,
  children,
  createUniqueId,
  onCleanup,
  onMount,
  splitProps,
  useContext,
} from "solid-js";
import { Portal } from "solid-js/web";
import { TabListContext } from "./tabListContext.js";
import controlStyles from "./controls.module.css";
import { IconButton } from "./IconButton.jsx";
import { Icon } from "./Icon.jsx";
import styles from "./TabList.module.css";

/** A tab with optional actions shown beside the list while it is selected. */
export function Tab(props) {
  const list = useContext(TabListContext);
  if (!list) throw new Error("Tab must be rendered inside TabList.");
  const [local, native] = splitProps(props, [
    "value",
    "controls",
    "disabled",
    "hidden",
    "children",
    "actions",
    "onClick",
    "class",
    "id",
    "onClose",
    "closeLabel",
    "closeDisabled",
  ]);
  const generatedId = `tab-${createUniqueId()}`;
  const tabId = () => local.id || generatedId;
  const entry = {
    value: () => local.value,
    disabled: () => local.disabled,
    hidden: () => local.hidden,
    hasActions: () => Boolean(actions()),
    element: null,
  };
  const actions = children(() => local.actions);
  onMount(() => {
    const unregister = list.register(entry);
    onCleanup(unregister);
  });
  return (
    <div
      class={styles.item}
      role="presentation"
      hidden={local.hidden}
      data-selected={list.selected(local.value) ? "" : undefined}
    >
      <button
        {...native}
        id={tabId()}
        ref={(element) => {
          entry.element = element;
        }}
        class={`${controlStyles.control} ${controlStyles.button} ${list.selected(local.value) ? controlStyles.primary : ""} ${styles.tab} ${local.class || ""}`}
        type="button"
        role="tab"
        aria-controls={local.controls}
        aria-selected={String(list.selected(local.value))}
        tabindex={list.tabIndex(entry)}
        disabled={local.disabled}
        onClick={(event) => list.select(local.value, event, local.onClick)}
      >
        {local.children}
      </button>
      <Show when={local.onClose}>
        <IconButton
          class={`${styles.close} ${list.selected(local.value) ? controlStyles.primary : ""}`}
          label={local.closeLabel || "Close tab"}
          disabled={local.closeDisabled}
          onClick={(event) => {
            event.stopPropagation();
            local.onClose?.(event);
          }}
        >
          <Icon name="close" />
        </IconButton>
      </Show>
      <Show
        when={
          list.selected(local.value) &&
          !local.hidden &&
          actions() &&
          list.actionsHost()
        }
      >
        {(host) => (
          <Portal mount={host()}>
            <span class={styles.actionContent}>{actions()}</span>
          </Portal>
        )}
      </Show>
    </div>
  );
}
