import { For, Show, createEffect, createSignal } from "solid-js";
import { Icon, TextArea } from "@ui-lib";
import styles from "./PortsInput.module.css";

const PORT = /^\d{1,5}$/;
const validPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;

/** Controlled editor for the portsController string selection (e.g. "3000-3010,4200"). */
export function PortsInput(props) {
  const [draft, setDraft] = createSignal("");
  const [start, setStart] = createSignal("");
  const [end, setEnd] = createSignal("");
  const [rangeMode, setRangeMode] = createSignal(false);
  const [plainText, setPlainText] = createSignal(false);
  const [insertAt, setInsertAt] = createSignal(null);
  const [editing, setEditing] = createSignal(null);
  let entry, startInput, endInput, plainEditor;
  createEffect(() => {
    if (rangeMode()) queueMicrotask(() => (editing() !== null ? startInput : endInput)?.focus());
    else if ((insertAt() !== null || editing() !== null) && !plainText()) queueMicrotask(() => entry?.focus());
  });
  const tokens = () => props.value().split(",").map((x) => x.trim()).filter(Boolean);
  const update = (items) => props.onChange(items.join(","));
  const focusEntry = () => queueMicrotask(() => entry?.focus());
  const clearEditState = () => {
    setDraft(""); setStart(""); setEnd(""); setRangeMode(false); setEditing(null); setInsertAt(null);
  };
  const cancelEdit = () => {
    clearEditState();
    focusEntry();
  };
  const clampEnd = (candidate, minimum = Number(start())) => {
    if (candidate === "") return String(minimum);
    const value = Number(candidate);
    if (!Number.isFinite(value)) return String(minimum);
    return String(Math.min(65535, Math.max(minimum, Math.trunc(value))));
  };
  const commitRange = () => {
    const first = String(startInput?.value ?? start()).trim();
    const last = String(endInput?.value ?? end()).trim() || first;
    if (!PORT.test(first) || !PORT.test(last) || !validPort(+first) || !validPort(+last) || +last < +first) return false;
    const value = first === last ? first : `${first}-${last}`;
    const items = tokens();
    if (editing() !== null) items[editing()] = value; else if (insertAt() !== null) items.splice(Math.min(insertAt(), items.length), 0, value); else items.push(value);
    update(items);
    setDraft(""); setStart(""); setEnd(""); setRangeMode(false); setInsertAt(null); setEditing(null);
    return true;
  };
  const add = () => {
    if (rangeMode()) return commitRange();
    const first = rangeMode() ? start().trim() : draft().trim();
    const last = first;
    if (!PORT.test(first) || !PORT.test(last) || !validPort(+first) || !validPort(+last) || +last < +first) return false;
    const items = tokens();
    if (editing() !== null) items[editing()] = first; else if (insertAt() !== null) items.splice(Math.min(insertAt(), items.length), 0, first); else items.push(first);
    update(items);
    setDraft(""); setStart(""); setEnd(""); setRangeMode(false); setInsertAt(null); setEditing(null);
    return true;
  };
  const finishSingleEdit = (event) => {
    if (event.currentTarget.getAttribute("aria-label") !== "Edit port" || editing() === null || rangeMode()) return;
    if (!add()) clearEditState();
  };
  const finishRangeEdit = (event) => {
    if (editing() === null || event.currentTarget.parentElement.contains(event.relatedTarget)) return;
    if (!commitRange()) clearEditState();
  };
  const remove = (index) => {
    update(tokens().filter((_, i) => i !== index));
    setEditing(null); setRangeMode(false);
    setInsertAt(index);
    queueMicrotask(() => entry?.focus());
  };
  const edit = (index) => {
    const token = tokens()[index];
    const [first, last] = token.split("-");
    setEditing(index); setInsertAt(null);
    if (last) { setStart(first); setEnd(last); setRangeMode(true); }
    else { setRangeMode(false); setDraft(first); }
    setTimeout(() => (last ? startInput : entry)?.focus(), 0);
  };
  const keyDown = (event) => {
    if (event.key === "Escape" && editing() !== null) {
      event.preventDefault(); event.stopPropagation(); cancelEdit();
    } else if (event.key === ":" && !rangeMode()) {
      const value = draft().trim();
      if (!PORT.test(value) || !validPort(+value)) return;
      event.preventDefault(); setStart(value); setEnd(value); setRangeMode(true);
      setTimeout(() => endInput?.focus(), 0);
    } else if (event.key === ",") {
      event.preventDefault(); if (add()) focusEntry();
    } else if (event.key === "Enter") {
      event.preventDefault(); if (add()) focusEntry();
    } else if (event.key === "Backspace" && !draft() && !rangeMode() && editing() === null) {
      const previous = (insertAt() ?? tokens().length) - 1;
      if (previous >= 0) { event.preventDefault(); remove(previous); }
    }
  };
  const rangeKeyDown = (event) => {
    if (event.key === "Escape" && editing() !== null) {
      event.preventDefault(); event.stopPropagation(); cancelEdit(); return;
    }
    if (event.key === "Tab" && !event.shiftKey && event.currentTarget === startInput) {
      event.preventDefault(); endInput?.focus(); return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      if (commitRange()) focusEntry();
      return;
    }
    if (event.key === "," || event.key === "Enter") {
      event.preventDefault(); if (add()) focusEntry();
    }
  };
  const onPaste = (event) => {
    const text = event.clipboardData?.getData("text")?.trim();
    if (!text || !text.includes(",")) return;
    const pasted = text.split(",").map((item) => item.trim());
    if (!pasted.every((item) => /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.test(item) && (() => { const [a,b] = item.split("-").map(Number); return validPort(a) && validPort(b ?? a) && (b ?? a) >= a; })())) return;
    event.preventDefault(); update([...tokens(), ...pasted]); setDraft("");
  };
   const Entry = () => <input ref={(el) => { entry = el; if (editing() !== null) queueMicrotask(() => el.focus()); }} class={editing() !== null ? styles.tagEntry : styles.entry} style={editing() !== null ? { width: `${Math.max(1, draft().length)}ch` } : undefined} type="text" aria-label={editing() !== null ? "Edit port" : "Add port or range"} value={draft()} placeholder={editing() !== null ? "" : "Add port…"} onInput={(e) => setDraft(e.currentTarget.value)} onKeyDown={keyDown} onPaste={onPaste} onBlur={finishSingleEdit} />;
  return <div class={styles.root}>
    <div class={styles.editor} classList={{ [styles.plainEditor]: plainText() }} aria-label="Port selection">
      <Show when={plainText()} fallback={<Show when={!rangeMode() || editing() !== null}>
        <For each={tokens()}>{(token, index) => <>
          <Show when={editing() === index()} fallback={<><Show when={insertAt() === index()}><Entry /></Show>
            <span class={styles.tag}>
              <button type="button" class={styles.tagValue} aria-label={`Edit ${token}`} onClick={() => edit(index())}>{token.replace("-", " — ")}</button><button type="button" class={styles.remove} aria-label={`Remove ${token}`} onClick={() => remove(index())}><Icon name="close" /></button>
            </span></>}>
           <span class={styles.tag}><Show when={rangeMode()} fallback={<Entry />}><span class={styles.range}><input ref={(el) => { startInput = el; }} style={{ width: `${Math.max(1, start().length) + 4}ch` }} type="number" min="1" max="65535" aria-label="Range start" value={start()} onInput={(e) => { const next = e.currentTarget.value; setStart(next); setEnd(clampEnd(end(), Number(next) || 1)); }} on:keydown={rangeKeyDown} onBlur={finishRangeEdit} /><span> — </span><input ref={(el) => { endInput = el; }} style={{ width: `${Math.max(1, end().length) + 4}ch` }} type="number" min={start() || 1} max="65535" aria-label="Range end" value={end()} onInput={(e) => setEnd(clampEnd(e.currentTarget.value))} on:keydown={rangeKeyDown} onBlur={finishRangeEdit} /></span></Show></span>
          </Show>
        </>}</For>
       <Show when={editing() === null && (insertAt() === null || insertAt() >= tokens().length)}><Entry /></Show>
      </Show>}>
        <TextArea ref={plainEditor} aria-label="Plain-text port selection" value={props.value()} onInput={(e) => props.onChange(e.currentTarget.value)} />
      </Show>
      <Show when={!plainText() && rangeMode() && editing() === null}>
          <span class={styles.range}><input ref={(el) => { startInput = el; }} type="number" min="1" max="65535" aria-label="Range start" value={start()} onInput={(e) => { const next = e.currentTarget.value; setStart(next); setEnd(clampEnd(end(), Number(next) || 1)); }} on:keydown={rangeKeyDown} /><span> — </span><input ref={(el) => { endInput = el; }} type="number" min={start() || 1} max="65535" aria-label="Range end" value={end()} onInput={(e) => setEnd(clampEnd(e.currentTarget.value))} on:keydown={rangeKeyDown} onBlur={() => setEnd(clampEnd(end()))} /></span>
      </Show>
    </div>
    <Show when={draft() && !rangeMode() && !PORT.test(draft().trim()) || rangeMode() && ((!PORT.test(start()) || !validPort(+start())) || end() && (!PORT.test(end()) || !validPort(+end()) || +end() < +start()))}>
      <span class={styles.error} role="alert">Enter ports from 1 to 65535; a range end must be at least its start.</span>
    </Show>
    <button type="button" class={styles.modeToggle} aria-pressed={plainText()} onClick={() => {
      setPlainText(!plainText());
      queueMicrotask(() => plainText() ? plainEditor?.focus() : entry?.focus());
    }}>{plainText() ? "Use port tags" : "Edit as plain text"}</button>
  </div>;
}
