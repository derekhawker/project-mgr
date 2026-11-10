import { createEffect, For, Show } from "solid-js";
import { Button, Collapsible, Input, Modal, Select, TextArea } from "@ui-lib";
import { SetupProgressPanel } from "./SetupProgressPanel.jsx";
import { newWorkProgressDestination } from "./newWorkProgress.js";
import styles from "./NewWorkModal.module.css";

export function NewWorkModal(props) {
  let modal;
  createEffect(() => {
    const review = props.reviewVisible();
    queueMicrotask(() => {
      if (!modal?.open) return;
      modal.querySelector("[data-modal-body]").scrollTop = 0;
      const selector = review
        ? props.proposal().workType === "workspace"
          ? "#workspace-review-name"
          : "#quick-request-directory"
        : "#new-work-prompt";
      modal.querySelector(selector)?.focus({ preventScroll: true });
    });
  });
  const proposal = () => props.proposal();
  const progressDestination = () =>
    newWorkProgressDestination(
      props.captureVisible(),
      props.reviewVisible(),
      proposal().workType,
    );
  const labels = () =>
    props.workType() === "quick_request"
      ? [
          "Quick Request",
          "What do you want OpenCode to do?",
          "New Quick Request",
        ]
      : [
          "Workspace",
          "Describe the workspace you want to create.",
          "New Workspace",
        ];
  return (
    <Modal
      id="new-work-modal"
      ref={(element) => {
        modal = element;
        props.setModal(element);
      }}
      title={props.reviewVisible() ? proposal().title : labels()[2]}
      titleId={props.reviewVisible() ? "proposal-title" : "new-work-title"}
      size={props.reviewVisible() ? "wide" : "compact"}
      onCloseRequest={props.onCancel}
      footer={
        <>
          <Show when={props.captureVisible()}>
            <Show when={props.captureError()}>
              <p id="new-work-error" class={styles.error} role="alert">
                {props.captureError()}
              </p>
            </Show>
            <Button type="button" id="new-work-cancel" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="new-work-capture"
              disabled={props.captureDisabled()}
            >
              Continue
            </Button>
          </Show>
          <Show when={props.reviewVisible()}>
            <Show when={props.proposalError()}>
              <p id="proposal-error" class={styles.error} role="alert">
                {props.proposalError()}
              </p>
            </Show>
            <Button
              type="button"
              id="proposal-cancel"
              class={styles.cancel}
              onClick={props.onCancel}
            >
              Cancel
            </Button>
            <Button type="button" id="proposal-back" onClick={props.onBack}>
              Back
            </Button>
            <Button
              variant="primary"
              type="button"
              id="proposal-create"
              disabled={props.proposalCreateDisabled()}
              onClick={props.onConfirm}
            >
              {proposal().createLabel}
            </Button>
          </Show>
        </>
      }
    >
      <div id="new-work-modal-content" class={styles.content}>
        <section
          id="new-work"
          hidden={!props.captureVisible()}
          aria-labelledby="new-work-title"
        >
          <form
            id="new-work-capture"
            onSubmit={props.onCapture}
            onKeyDown={props.onEnterToSubmit}
          >
            <div>
              <p id="new-work-guidance" class={styles.guidance}>
                {labels()[1]}
              </p>
              <Show when={props.workType() === "workspace"}>
                <Collapsible id="proposal-prompt-preview" class={styles.previewDisclosure} label="Proposal prompt preview" maxHeight="20vh" onToggle={props.onPreviewToggle}>
                  <pre class={styles.preview}>{props.preview()}</pre>
                </Collapsible>
              </Show>
              <Show when={props.workType() === "quick_request"}>
                <div class={styles.directoryField}>
                  <label for="quick-request-custom-directory">Working directory</label>
                  <div class={styles.directoryRow}>
                    <Input id="quick-request-custom-directory" type="text" required value={props.customDirectory?.() ?? props.defaultDirectory?.() ?? ""} onInput={(event) => props.onCustomDirectoryInput(event.currentTarget.value)} />
                    <Button type="button" onClick={props.onChooseDirectory}>Choose folder</Button>
                  </div>
                </div>
              </Show>
              <label id="new-work-prompt-label" for="new-work-prompt">
                Original prompt
              </label>
              <TextArea
                id="new-work-prompt"
                ref={props.setPromptElement}
                required
                rows="9"
                placeholder={labels()[1]}
                aria-describedby="new-work-guidance"
                value={props.prompt()}
                onInput={(event) => props.setPrompt(event.currentTarget.value)}
              />
              <Show when={progressDestination() === "capture"}>
                <SetupProgressPanel
                  visible={props.progressVisible}
                  rows={props.progressRows}
                />
              </Show>
            </div>
          </form>
        </section>
        <section
          id="new-work-review"
          hidden={!props.reviewVisible()}
          aria-labelledby="proposal-title"
        >
          <div class={styles.review}>
            <div
              id="workspace-review-form"
              class={styles.fields}
              hidden={proposal().workType !== "workspace"}
            >
              <label for="workspace-review-name">Workspace name</label>
              <Input
                id="workspace-review-name"
                type="text"
                required
                maxlength="120"
                value={props.workspaceName()}
                onInput={(event) =>
                  props.setWorkspaceName(event.currentTarget.value)
                }
              />
              <p>Choose one existing repository, or leave it unselected to create a new local repository.</p>
            </div>
            <blockquote id="proposal-original" hidden>
              {proposal().originalPrompt}
            </blockquote>
            <section
              id="proposal-repository-section"
              hidden={proposal().workType === "quick_request"}
            >
              <h3>Repositories</h3>
              <ul id="proposal-repositories" class={styles.repositories}>
                {props.proposalRepositories?.()}
              </ul>
            </section>
            <Show when={progressDestination() === "workspace"}>
              <SetupProgressPanel
                visible={props.progressVisible}
                rows={props.progressRows}
              />
            </Show>
            <div
              id="quick-request-directory-review"
              hidden={proposal().workType !== "quick_request"}
            >
              <h3>Confirm working directory</h3>
              <h3>Original prompt</h3>
              <blockquote id="quick-request-original">
                {proposal().originalPrompt}
              </blockquote>
              <p>
                The original prompt will be sent unchanged after confirmation.
              </p>
              <label for="quick-request-directory">OpenCode working directory</label>
              <div class={styles.directoryRow}>
                <Input id="quick-request-directory" type="text" value={props.directoryPath()} onInput={(event) => props.onCustomDirectoryInput(event.currentTarget.value)} />
                <Button type="button" onClick={props.onChooseDirectory}>Choose folder</Button>
                <Button type="button" onClick={props.onResetDirectory}>Reset to default</Button>
              </div>
            </div>
            <Show when={progressDestination() === "quick_request"}>
              <SetupProgressPanel
                visible={props.progressVisible}
                rows={props.progressRows}
              />
            </Show>
            <div class={styles.fields}>
              <label for="proposal-model">Model</label>
              <Select
                id="proposal-model"
                required
                disabled={props.proposalModelDisabled()}
                aria-busy={props.proposalModelDisabled() ? "true" : undefined}
                value={props.proposalSelectedModel()}
                onChange={(event) =>
                  props.setProposalSelectedModel(event.currentTarget.value)
                }
              >
                <For each={props.proposalModels()}>
                  {(model) => (
                    <option value={model.value}>{model.label}</option>
                  )}
                </For>
                <Show when={props.proposalModelDisabled()}>
                  <option value="">Loading models…</option>
                </Show>
              </Select>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
