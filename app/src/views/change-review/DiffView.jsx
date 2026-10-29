import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { html } from "diff2html";
import createDOMPurify from "dompurify";
import "diff2html/bundles/css/diff2html.min.css";
import styles from "./DiffView.module.css";

export function DiffView(props) {
  const sanitize = createDOMPurify(document.defaultView);
  const [fullDiff, setFullDiff] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  let request = 0;
  createEffect(() => {
    const file = props.file();
    const visible = props.visible();
    const current = ++request;
    setFullDiff(null);
    setLoading(false);
    setError("");
    if (
      visible &&
      props.onFullDiff &&
      file?.diff &&
      file.status !== "untracked" &&
      !file.diffError
    ) {
      void showFull(file, current);
    }
  });
  onCleanup(() => {
    request++;
  });
  async function showFull(file, current) {
    setLoading(true);
    setError("");
    try {
      const diff = await props.onFullDiff(file);
      if (current === request) setFullDiff(diff);
    } catch (cause) {
      if (current === request) setError(String(cause));
    } finally {
      if (current === request) setLoading(false);
    }
  }
  const rendered = createMemo(() => {
    const diff = fullDiff() ?? props.file()?.diff;
    if (!diff) return "";
    const markup = sanitize.sanitize(
      html(diff, {
        drawFileList: false,
        outputFormat:
          props.mode() === "split" ? "side-by-side" : "line-by-line",
        matching: "none",
        colorScheme: "light",
      }),
    );
    if (props.mode() !== "split") return markup;

    // diff2html renders split sides as separate tables. Combining their cells
    // into shared rows lets the browser align both sides when either wraps.
    const container = document.createElement("div");
    container.innerHTML = markup;
    for (const file of container.querySelectorAll(".d2h-files-diff")) {
      const sides = file.querySelectorAll(":scope > .d2h-file-side-diff");
      if (sides.length !== 2) continue;
      const left = sides[0].querySelector("tbody");
      const right = sides[1].querySelector("tbody");
      if (!left || !right || left.children.length !== right.children.length)
        continue;
      for (let i = 0; i < left.children.length; i++) {
        left.children[i].append(...Array.from(right.children[i].children));
      }
      sides[0].classList.add("d2h-aligned-split");
      sides[1].remove();
    }
    return container.innerHTML;
  });
  return (
    <section class="change-review-diff-pane" aria-label="Selected file diff">
      <h2>{props.file()?.path || "Select a changed file"}</h2>
      <Show when={loading()}>
        <p role="status">Loading full file context…</p>
      </Show>
      <Show when={error()}>
        <p role="alert">
          Full file context unavailable: {error()}. Showing changed sections.
        </p>
      </Show>
      <Show
        when={!props.file()?.diffError}
        fallback={<p>{props.file()?.diffError}</p>}
      >
        <Show
          when={rendered()}
          fallback={<p>No textual differences for this file.</p>}
        >
          <div
            class={`change-review-rendered-diff ${styles.diff}`}
            innerHTML={rendered()}
          />
        </Show>
      </Show>
    </section>
  );
}
