import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import styles from "../../../application/workArea.module.css";
import { MultiFileDiffView } from "./MultiFileDiffView.jsx";
import { FileTree } from "../../../components/file-navigation/FileTree.jsx";
import { FileNavigatorDivider } from "../../../components/file-navigation/FileNavigatorDivider.jsx";

export function ChangeReviewPanel(props) {
  const [selectedFile, setSelectedFile] = createSignal(null);
  const [search, setSearch] = createSignal("");
  const repositories = createMemo(() => props.repositories() || []);
  createEffect(() => {
    repositories();
    setSelectedFile(null);
  });
  const allFiles = () => repositories().flatMap((repo) => repo.files);
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
                {repository().mergeBase
                  ? ` · merge base ${repository().mergeBase.slice(0, 8)}`
                  : ""}
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
          <label class="change-review-mode">
            <span>Split diff</span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Split diff"
              checked={props.mode() === "split"}
              onChange={(event) =>
                props.onMode(event.currentTarget.checked ? "split" : "unified")
              }
            />
          </label>
        </div>
      </header>
      <Show when={!props.loading?.()}>
        <div
          class="change-review-content"
          style={{
            "--navigator-width": `${props.navigatorWidth?.() ?? 285}px`,
          }}
        >
          <aside
            class="change-review-files"
            aria-label="Changed files grouped by repository"
          >
            <label class="change-review-search">
              <input
                type="search"
                placeholder="Search changed files"
                aria-label="Search changed files"
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
              />
            </label>
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
                    <For
                      each={[
                        {
                          source: "branch",
                          label: "Branch changes",
                          files: repository.files.filter(
                            (entry) => entry.changeSource === "branch",
                          ),
                        },
                        {
                          source: "workingTree",
                          label: "Local changes",
                          files: repository.files.filter(
                            (entry) => entry.changeSource !== "branch",
                          ),
                        },
                      ].filter((group) => group.files.length > 0)}
                    >
                      {(group) => {
                        const matchingFiles = () =>
                          group.files.filter((entry) =>
                            entry.path
                              .toLocaleLowerCase()
                              .includes(search().trim().toLocaleLowerCase()),
                          );
                        return (
                          <details open>
                            <summary>
                              {group.label} ({group.files.length})
                            </summary>
                            <Show
                              when={matchingFiles().length}
                              fallback={
                                <p class="change-review-empty-search">
                                  No matching files.
                                </p>
                              }
                            >
                              <FileTree
                                files={matchingFiles()}
                                isSelected={(entry) => file() === entry}
                                onSelect={setSelectedFile}
                                renderFile={(entry, name) =>
                                  `${name} · ${entry.status}`
                                }
                              />
                            </Show>
                          </details>
                        );
                      }}
                    </For>
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
          <MultiFileDiffView
            repositories={repositories}
            selectedFile={file}
            mode={props.mode}
            visible={props.visible}
            onFileViewed={props.onFileViewed}
          />
        </div>
      </Show>
    </section>
  );
}
