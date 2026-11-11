import { For, Show, splitProps } from "solid-js";
import { ActionMenu } from "./ActionMenu.jsx";
import { ActionMenuItem } from "./ActionMenuItem.jsx";
import { Icon } from "./Icon.jsx";
import styles from "./Select.module.css";

/** A labelled choice control with native form validity and an ActionMenu popup. */
export function Select(props) {
  const [local, rest] = splitProps(props, [
    "id",
    "label",
    "options",
    "value",
    "onChange",
    "required",
    "disabled",
    "class",
    "className",
    "name",
    "placeholder",
    "aria-busy",
    "aria-describedby",
    "portal",
  ]);
  const options = () => local.options || [];
  const selected = () =>
    options().find((option) => String(option.value) === String(local.value));
  const selectedLabel = () =>
    selected()?.label || local.placeholder || "Choose an option";
  const triggerId = () => local.id;

  return (
    <div class={`${styles.select} ${local.class || local.className || ""}`}>
      <Show when={local.label}>
        <label
          id={`${local.id}-label`}
          for={triggerId()}
          onClick={() => document.getElementById(triggerId())?.focus()}
        >
          {local.label}
        </label>
      </Show>
      <ActionMenu
        triggerProps={rest}
        triggerId={triggerId()}
        contentId={`${local.id}-options`}
        label={`${local.label ? `${local.label}: ` : ""}${selectedLabel()}`}
        triggerText={selectedLabel()}
        actionsLabel={local.label || "Choose an option"}
        triggerRole="combobox"
        triggerHasPopup="listbox"
        triggerLabelledBy={local.label ? `${local.id}-label ${local.id}-current` : undefined}
        triggerDescribedBy={local["aria-describedby"]}
        triggerBusy={local["aria-busy"]}
        triggerClass={styles.trigger}
        contentClass={styles.options}
        contentRole="listbox"
        portal={local.portal !== false}
        surfaceVariant="neutral"
        disabled={local.disabled}
      >
        <For each={options()}>
          {(option) => (
            <ActionMenuItem
              role="option"
              data-value={String(option.value)}
              aria-selected={String(String(option.value) === String(local.value))}
              disabled={option.disabled}
              ref={(element) => {
                element?.addEventListener("click", () => {
                  local.onChange?.(option.value);
                  element.closest("details")?.removeAttribute("open");
                });
              }}
            >
              {option.label}
              <Show when={String(option.value) === String(local.value)}>
                <Icon name="check" />
              </Show>
            </ActionMenuItem>
          )}
        </For>
      </ActionMenu>
      <span id={`${local.id}-current`} class={styles.accessibleValue}>
        {selectedLabel()}
      </span>
      <input
        id={`${local.id}-value`}
        class={styles.validation}
        type="text"
        name={local.name}
        value={local.value ?? ""}
        required={local.required}
        disabled={local.disabled}
        aria-hidden="true"
        tabIndex={-1}
        onInvalid={(event) => {
          event.preventDefault();
          document.getElementById(triggerId())?.focus();
        }}
      />
    </div>
  );
}
