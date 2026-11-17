import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import styles from "./MultiFileDiffView.module.css";
import { buildReviewItems, createReviewHeaderPrefix } from "./reviewItems.js";

export function MultiFileDiffView(props) {
  const [loadError, setLoadError] = createSignal("");
  const [viewerReady, setViewerReady] = createSignal(false);
  let root;
  let viewer;
  let viewerOptions;
  let itemByFile = new Map();
  let fileByDiff = new Map();
  let generation = 0;
  let lastSelectedFile;

  createEffect(() => {
    const visible = props.visible();
    const repositories = props.repositories() || [];
    if (!visible || !root) return;

    const request = ++generation;
    setLoadError("");
    void import("@pierre/diffs")
      .then(({ CodeView, parsePatchFiles }) => {
        if (request !== generation || !root) return;
        if (!viewer) {
          viewerOptions = {
            theme: { dark: "pierre-dark", light: "pierre-light" },
            stickyHeaders: true,
            diffStyle: props.mode(),
            layout: { paddingTop: 8, paddingBottom: 16, gap: 12 },
            renderHeaderPrefix: (fileDiff) =>
              createReviewHeaderPrefix({
                fileByDiff,
                itemByFile,
                viewer,
                onViewedChange: props.onFileViewed,
                onError: (error) =>
                  setLoadError(`Could not save viewed state: ${String(error)}`),
                onSuccess: () => setLoadError(""),
                styles,
              })(fileDiff),
          };
          viewer = new CodeView(viewerOptions);
          viewer.setup(root);
          setViewerReady(true);
        }
        const review = buildReviewItems(repositories, parsePatchFiles);
        itemByFile = review.itemByFile;
        fileByDiff = review.fileByDiff;
        viewer.setItems(review.items);
        if (props.selectedFile()) scrollToFile(props.selectedFile());
      })
      .catch((error) => {
        if (request === generation)
          setLoadError(`Could not load the diff viewer: ${String(error)}`);
      });

    onCleanup(() => {
      generation++;
    });
  });

  createEffect(() => {
    const mode = props.mode();
    if (viewerReady()) {
      viewerOptions = { ...viewerOptions, diffStyle: mode };
      viewer?.setOptions(viewerOptions);
    }
  });

  createEffect(() => {
    const selected = props.selectedFile();
    if (selected && selected !== lastSelectedFile && viewer)
      scrollToFile(selected);
    lastSelectedFile = selected;
  });

  onCleanup(() => {
    generation++;
    viewer?.cleanUp();
    viewer = undefined;
  });

  function scrollToFile(file) {
    const id = itemByFile.get(file);
    if (!id || !viewer) return;
    viewer.scrollTo({ type: "item", id, behavior: "smooth-auto" });
  }

  return (
    <section
      class={`change-review-diff-pane ${styles.pane}`}
      aria-label="All changed-file diffs"
    >
      <Show when={loadError()}>
        <p role="alert">{loadError()}</p>
      </Show>
      <div class={styles.viewport} ref={(element) => (root = element)} />
    </section>
  );
}
