import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Button } from "@ui-lib";
import styles from "../../application/workArea.module.css";
import { DiffView } from "./DiffView.jsx";
import { FileTree } from "../../components/FileTree.jsx";
import { FileNavigatorDivider } from "../../components/FileNavigatorDivider.jsx";

export function ChangeReviewPanel(props) {
  const [selectedFile, setSelectedFile] = createSignal(null);
  const repositories = createMemo(() => props.repositories() || []);
  createEffect(() => {
    repositories();
    setSelectedFile(null);
  });
  const allFiles = () =>
    repositories().flatMap((repo) => (repo.comparisonError ? [] : repo.files));
  const file = () => selectedFile() || allFiles()[0] || null;
  const selectedRepository = () =>
    repositories().find((repository) => repository.files.includes(file())) ||
    (repositories().length === 1 ? repositories()[0] : null);
  return (
    <section
      id="change-review-page"
      class={`change-review-page ${styles.review}`}
      hidden={!props.visible()}
      role="tabpanel"
      aria-labelledby="show-change-review"
      tabindex="0"
    >
      <header class="change-review-heading">
        <Show when={selectedRepository()}>
          {(repository) => (
            <div
              class="change-review-current-repository"
              title={repository().path}
              aria-label={`${repository().name}, ${repository().path}, ${repository().files.length} files`}
            >
              <strong>
                {repository().name} ({repository().files.length})
              </strong>
              <span>
                Compare with: {repository().comparisonTarget || "unavailable"}
              </span>
            </div>
          )}
        </Show>
        <Show
          when={!repositories().length && !props.error() && props.summary()}
        >
          <p role="status">{props.summary()}</p>
        </Show>
        <div class="change-review-actions">
          <div
            class="change-review-mode"
            role="group"
            aria-label="Diff presentation"
          >
            <Button
              data-review-mode="unified"
              variant={props.mode() === "unified" ? "selected" : undefined}
              aria-pressed={props.mode() === "unified"}
              onClick={() => props.onMode("unified")}
            >
              Unified
            </Button>
            <Button
              data-review-mode="split"
              variant={props.mode() === "split" ? "selected" : undefined}
              aria-pressed={props.mode() === "split"}
              onClick={() => props.onMode("split")}
            >
              Split
            </Button>
          </div>
        </div>
      </header>
      <Show when={!props.loading?.()}>
        <div
          class="change-review-content"
          style={{
            "--navigator-width": `${props.navigatorWidth?.() ?? 300}px`,
          }}
        >
          <aside
            class="change-review-files"
            aria-label="Changed files grouped by repository"
          >
            <For each={repositories()}>
              {(repository) => (
                <section class="change-review-repository">
                  <Show when={repositories().length > 1}>
                    <h2
                      title={repository.path}
                      aria-label={`${repository.name}, ${repository.path}, ${repository.files.length} files`}
                    >
                      {repository.name} ({repository.files.length})
                    </h2>
                  </Show>
                  <Show when={repository.comparisonError}>
                    <p class="change-review-error">
                      {repository.comparisonError}
                    </p>
                  </Show>
                  <Show
                    when={repository.files.length > 0}
                    fallback={
                      <p>
                        {repository.comparisonError
                          ? "No working-tree changes to list. Comparison diff is unavailable."
                          : "No changed files against the selected comparison branch or in the working tree."}
                      </p>
                    }
                  >
                    <FileTree
                      files={repository.files}
                      isSelected={(entry) => file() === entry}
                      onSelect={setSelectedFile}
                      renderFile={(entry, name) => `${name} · ${entry.status}`}
                    />
                  </Show>
                </section>
              )}
            </For>
            <Show when={!repositories().length}>
              <p>
                {props.error() ||
                  "This workspace has no repositories to review."}
              </p>
            </Show>
          </aside>
          <FileNavigatorDivider
            width={props.navigatorWidth}
            onResize={props.onNavigatorResize}
          />
          <DiffView
            file={file}
            mode={props.mode}
            visible={props.visible}
            onFullDiff={
              props.onFullDiff &&
              ((entry) => {
                const repository = repositories().find((item) =>
                  item.files.includes(entry),
                );
                if (!repository)
                  return Promise.reject(
                    new Error("Repository is no longer available."),
                  );
                return props.onFullDiff(repository.repositoryId, entry.path);
              })
            }
          />
        </div>
      </Show>
    </section>
  );
}
