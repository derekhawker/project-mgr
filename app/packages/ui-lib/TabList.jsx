import { createSignal, onCleanup, onMount, splitProps } from "solid-js";
import { TabListContext } from "./tabListContext.js";
import styles from "./TabList.module.css";

/** Controlled tab strip for panels whose lifetime remains with the caller. */
export function TabList(props) {
  const [local, native] = splitProps(props, [
    "value",
    "onChange",
    "label",
    "labelledBy",
    "orientation",
    "children",
    "class",
    "hidden",
    "id",
  ]);
  let visualList;
  let focusedControl;
  const [entries, setEntries] = createSignal([]);
  const [actionsHost, setActionsHost] = createSignal();
  const [domOrder, setDomOrder] = createSignal("");
  const visible = () => {
    return entries()
      .filter((entry) => !entry.hidden())
      .sort((a, b) =>
        a.element.compareDocumentPosition(b.element) & 4 ? -1 : 1,
      );
  };
  const ownedIds = () => {
    domOrder();
    return (
      visible()
        .map((entry) => entry.element.id)
        .join(" ") || undefined
    );
  };
  const enabled = () => visible().filter((entry) => !entry.disabled());
  const entryPoint = () => {
    const tabs = enabled();
    return tabs.find((entry) => entry.value() === local.value) || tabs[0];
  };
  onMount(() => {
    if (import.meta.env.DEV && !local.label && !local.labelledBy)
      console.warn("TabList requires a label or labelledBy.");
    const document = visualList.ownerDocument;
    const observer = new document.defaultView.MutationObserver(() => {
      setDomOrder(
        [...visualList.querySelectorAll('[role="tab"]')]
          .map((tab) => tab.id)
          .join(" "),
      );
      // Closing/reconciling records may remove the focused close button.
      // Recover only if focus has not already moved to another control.
      if (focusedControl && !focusedControl.isConnected) {
        if (document.activeElement === document.body)
          entryPoint()?.element.focus();
        focusedControl = undefined;
      }
    });
    observer.observe(visualList, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "id"],
    });
    onCleanup(() => observer.disconnect());
  });
  const context = {
    selected: (value) => local.value === value,
    tabIndex: (entry) => (entryPoint() === entry ? 0 : -1),
    actionsHost,
    select(value, event, onClick) {
      const focused =
        event.currentTarget === event.currentTarget.ownerDocument.activeElement;
      onClick?.(event);
      if (!event.defaultPrevented) local.onChange?.(value, event);
      // Controlled callers may reconcile their tab records during activation.
      if (focused)
        enabled()
          .find((entry) => entry.value() === value)
          ?.element.focus();
    },
    register(entry) {
      setEntries((items) => [...items, entry]);
      return () =>
        setEntries((items) => items.filter((item) => item !== entry));
    },
  };
  function handleKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
      return;
    const tabs = enabled();
    // Close/restart actions are siblings of the tab, never navigation targets.
    const current = tabs.findIndex((entry) => entry.element === event.target);
    const forward =
      local.orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    const backward = local.orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    if (current < 0 || ![forward, backward, "Home", "End"].includes(event.key))
      return;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (current + (event.key === forward ? 1 : -1) + tabs.length) %
            tabs.length;
    event.preventDefault();
    tabs[next].element.focus();
    tabs[next].element.click();
  }
  return (
    <TabListContext.Provider value={context}>
      <div class={`${styles.strip} ${local.class || ""}`} hidden={local.hidden}>
        {/* ARIA owns only the tabs, not their visually adjacent close buttons. */}
        <div
          id={local.id}
          class={styles.semantics}
          role="tablist"
          aria-label={local.label}
          aria-labelledby={local.labelledBy}
          aria-orientation={local.orientation || "horizontal"}
          aria-owns={ownedIds()}
        />
        <div
          {...native}
          ref={visualList}
          class={styles.list}
          data-orientation={local.orientation || "horizontal"}
          onKeyDown={handleKeyDown}
          onFocusIn={(event) => {
            focusedControl = event.target;
          }}
        >
          {local.children}
        </div>
        <div
          ref={setActionsHost}
          class={styles.actions}
          role="group"
          aria-label="Selected tab actions"
          hidden={
            !entries().some(
              (entry) =>
                entry.value() === local.value &&
                !entry.hidden() &&
                entry.hasActions(),
            )
          }
        />
      </div>
    </TabListContext.Provider>
  );
}
