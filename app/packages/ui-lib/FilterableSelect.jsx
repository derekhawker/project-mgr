import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "./Button.jsx";
import { Input } from "./Input.jsx";
import styles from "./FilterableSelect.module.css";

/** Searchable listbox; arrows move, Enter selects, Escape closes. */
export function FilterableSelect(props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(-1);
  let input;
  let trigger;
  const disabled = () =>
    typeof props.disabled === "function" ? props.disabled() : props.disabled;
  createEffect(() => {
    if (props.autoOpen && !disabled()) openList();
    else setOpen(false);
  });
  const groups = () =>
    props.groups ?? [{ label: "", options: props.options ?? [] }];
  const options = createMemo(() =>
    groups().flatMap((group) =>
      group.options.map((option) => ({ ...option, group: group.label })),
    ),
  );
  const filtered = createMemo(() => {
    const term = query().trim().toLocaleLowerCase();
    return options().filter(
      (option) => !term || option.label.toLocaleLowerCase().includes(term),
    );
  });
  const selected = () =>
    options().find((option) => String(option.value) === String(props.value));
  const openList = () => {
    if (disabled()) return;
    setQuery("");
    setActiveIndex(-1);
    setOpen(true);
    queueMicrotask(() => input?.focus());
  };
  const choose = (option) => {
    if (!option || option.disabled) return;
    props.onChange?.(option.value);
    setOpen(false);
    setQuery("");
    queueMicrotask(() => trigger?.focus());
  };
  const onKeyDown = (event) => {
    if (!open() && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      queueMicrotask(() => trigger?.focus());
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Home") {
        setActiveIndex(filtered().findIndex((option) => !option.disabled));
        return;
      }
      if (event.key === "End") {
        setActiveIndex(filtered().findLastIndex((option) => !option.disabled));
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (!filtered().some((option) => !option.disabled)) return -1;
        let next =
          current < 0 ? (direction > 0 ? -1 : filtered().length) : current;
        do {
          next += direction;
          if (next < 0 || next >= filtered().length) return current;
        } while (filtered()[next]?.disabled);
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!filtered().length) return;
      choose(
        activeIndex() < 0
          ? filtered().find((option) => !option.disabled)
          : filtered()[activeIndex()],
      );
    }
  };
  const renderedGroups = createMemo(() => {
    const visible = filtered();
    return groups()
      .map((group) => ({
        label: group.label,
        options: visible.filter((option) => option.group === group.label),
      }))
      .filter((group) => group.options.length);
  });
  return (
    <div class={styles.root}>
      <Show when={props.label}>
        <label for={`${props.id}-trigger`} onClick={openList}>
          {props.label}
        </label>
      </Show>
      <Button
        ref={trigger}
        id={`${props.id}-trigger`}
        type="button"
        class={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={String(open())}
        aria-controls={`${props.id}-listbox`}
        aria-required={props.required ? "true" : undefined}
        disabled={disabled()}
        onClick={() => (open() ? setOpen(false) : openList())}
      >
        {selected()?.label ?? props.placeholder ?? "Choose an option"}
      </Button>
      <Show when={open()}>
        <div class={styles.popup}>
          <Input
            ref={input}
            type="text"
            role="combobox"
            aria-label={
              props.searchLabel ?? `Filter ${props.label ?? "options"}`
            }
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={`${props.id}-listbox`}
            aria-required={props.required ? "true" : undefined}
            aria-activedescendant={
              activeIndex() >= 0
                ? `${props.id}-option-${activeIndex()}`
                : undefined
            }
            placeholder="Type to filter…"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(-1);
            }}
            onKeyDown={onKeyDown}
            onBlur={(event) => {
              if (
                !event.currentTarget.parentElement?.contains(
                  event.relatedTarget,
                )
              )
                setOpen(false);
            }}
          />
          <div
            id={`${props.id}-listbox`}
            role="listbox"
            aria-label={props.label ?? "Options"}
            class={styles.options}
          >
            <Show
              when={filtered().length}
              fallback={<p class={styles.empty}>No matching options.</p>}
            >
              <For each={renderedGroups()}>
                {(group) => (
                  <div
                    role={group.label ? "group" : undefined}
                    aria-label={group.label || undefined}
                  >
                    <Show when={group.label}>
                      <div class={styles.groupLabel}>{group.label}</div>
                    </Show>
                    <For each={group.options}>
                      {(option) => {
                        const index = () => filtered().indexOf(option);
                        return (
                          <button
                            id={`${props.id}-option-${index()}`}
                            type="button"
                            role="option"
                            aria-selected={String(
                              String(option.value) === String(props.value),
                            )}
                            class={styles.option}
                            classList={{
                              [styles.active]: activeIndex() === index(),
                            }}
                            disabled={option.disabled}
                            tabIndex={-1}
                            onMouseEnter={() => setActiveIndex(index())}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(option)}
                          >
                            {option.label}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
