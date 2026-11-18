import { createEffect, createSignal, For, Show } from "solid-js";
import { ActionMenuItem, Button, ErrorMessage, Input, Modal } from "@ui-lib";
import styles from "./TicketLabelEditor.module.css";

/** Application-level editor for a Workspace ticket's coordination label. */
export function TicketLabelEditor(props) {
  const [open, setOpen] = createSignal(false);
  const [options, setOptions] = createSignal([]);
  const [query, setQuery] = createSignal("");
  const [suggestionsOpen, setSuggestionsOpen] = createSignal(false);
  const [pendingLabel, setPendingLabel] = createSignal(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  createEffect(() => {
    const selection = props.selection();
    if (!selection) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setOptions([]);
    setQuery("");
    setSuggestionsOpen(false);
    setPendingLabel(selection.ticket.projectLabel ?? null);
    setError("");
    void props.onLoadLabels().then(
      (labels) => {
        if (props.selection() === selection) setOptions(labels);
      },
      (cause) => {
        if (props.selection() === selection) setError(String(cause));
      },
    );
  });

  const close = () => {
    if (busy()) return;
    setOpen(false);
    props.onClose();
  };
  const filtered = () =>
    options().filter((option) =>
      option.label.toLowerCase().includes(query().trim().toLowerCase()),
    );
  const exactMatch = () =>
    options().some(
      (option) => option.label.toLowerCase() === query().trim().toLowerCase(),
    );
  const apply = async () => {
    const selection = props.selection();
    if (!selection || busy()) return;
    setBusy(true);
    setError("");
    try {
      await props.onApply(selection, pendingLabel());
      setOpen(false);
      props.onClose();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open()}
      title="Change ticket label"
      onCloseRequest={close}
      footer={() => (
        <div class={styles.actions}>
          <Button type="button" disabled={busy()} onClick={close}>Cancel</Button>
          <Button type="button" variant="primary" disabled={busy() || !pendingLabel()?.trim()} onClick={() => void apply()}>
            {busy() ? "Saving…" : "Apply label"}
          </Button>
        </div>
      )}
    >
      <div class={styles.editor}>
        <label class={styles.field}>
          Current label
          <Input aria-label="Current label" value={props.selection()?.ticket.projectLabel || ""} readOnly />
        </label>
        <label class={styles.field}>
          Search labels
          <Input
            aria-label="Search labels"
            autofocus
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setSuggestionsOpen(true);
            }}
          />
        </label>
        <ErrorMessage message={error()} />
        <Show when={query().trim() && suggestionsOpen()}>
          <div class={styles.choices} role="listbox" aria-label="Matching labels">
            <For each={filtered()}>
              {(option) => (
                <ActionMenuItem
                  role="option"
                  aria-selected={pendingLabel()?.toLowerCase() === option.label.toLowerCase()}
                  onClick={() => {
                    setPendingLabel(option.label);
                    setQuery(option.label);
                    setSuggestionsOpen(false);
                  }}
                >
                  {option.label}
                </ActionMenuItem>
              )}
            </For>
            <Show when={!exactMatch()}>
              <ActionMenuItem
                role="option"
                aria-selected={pendingLabel() === query().trim()}
                onClick={() => {
                  setPendingLabel(query().trim());
                  setQuery(query().trim());
                  setSuggestionsOpen(false);
                }}
              >
                Create “{query().trim()}”
              </ActionMenuItem>
            </Show>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
