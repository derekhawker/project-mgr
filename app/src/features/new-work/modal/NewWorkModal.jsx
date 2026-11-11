import { createEffect, Show } from "solid-js";
import { Button, Input, Modal, Select, TextArea } from "@ui-lib";
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
      const selector = props.workspaceVisible()
        ? "#workspace-repository-select"
        : review
          ? "#quick-request-directory"
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
  const labels = () => "What do you want OpenCode to do?";
  return (
    <Modal
      id="new-work-modal"
      ref={(element) => {
        modal = element;
        props.setModal(element);
      }}
      title={props.reviewVisible() ? proposal().title : "New Workspace"}
      titleId={props.reviewVisible() ? "proposal-title" : "new-work-title"}
      size={props.reviewVisible() ? "wide" : "compact"}
      onCloseRequest={props.onCancel}
      footer={
        <>
          <Show when={props.workspaceVisible()}>
            <Show when={props.workspaceError()}>
              <p id="workspace-create-error" class={styles.error} role="alert">
                {props.workspaceError()}
              </p>
            </Show>
            <Button type="button" id="workspace-cancel" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="workspace-create-form"
              disabled={props.workspaceCreateDisabled()}
            >
              Create Workspace
            </Button>
          </Show>
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
          id="new-work-workspace"
          hidden={!props.workspaceVisible()}
          aria-labelledby="new-work-title"
        >
          <form
            id="workspace-create-form"
            class={styles.review}
            onSubmit={props.onWorkspaceSubmit}
          >
            <div class={styles.fields}>
              <Select
                id="workspace-repository-select"
                label="Repository"
                required
                disabled={props.workspaceCatalogLoading()}
                value={props.workspaceRepositoryChoice()}
                placeholder="Choose a repository or create one"
                options={[
                  {
                    value: props.emptyWorkspaceChoice,
                    label: "Create an empty workspace",
                  },
                  ...props.workspaceRepositories().map((repository) => ({
                    value: repository.id,
                    label: `${repository.name} — ${repository.repositoryPath}`,
                  })),
                ]}
                onChange={props.onWorkspaceRepositoryChange}
              />
              <Show when={props.workspaceCatalogLoading()}>
                <p class={styles.guidance}>Loading registered repositories…</p>
              </Show>
              <Show when={props.workspaceRepositoryChoice()}>
                <label for="workspace-create-name">Workspace title</label>
                <Input
                  id="workspace-create-name"
                  type="text"
                  required
                  maxlength="120"
                  value={props.workspaceName()}
                  onInput={(event) =>
                    props.setWorkspaceName(event.currentTarget.value)
                  }
                />
              </Show>
              <Show when={props.workspaceEmptySelected()}>
                <label for="workspace-create-description">Short description</label>
                <TextArea
                  id="workspace-create-description"
                  required
                  rows="3"
                  maxlength="500"
                  placeholder="What is this workspace for?"
                  value={props.workspaceDescription()}
                  onInput={(event) =>
                    props.setWorkspaceDescription(event.currentTarget.value)
                  }
                />
              </Show>
            </div>
          </form>
        </section>
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
                {labels()}
              </p>
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
                placeholder={labels()}
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
              id="quick-request-directory-review"
              hidden={proposal().workType !== "quick_request"}
            >
              <h3>Confirm working directory</h3>
              <h3>Original prompt</h3>
              <blockquote id="quick-request-original">
                {proposal().originalPrompt}
              </blockquote>
              <p>The original prompt will be sent unchanged after confirmation.</p>
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
              <Select
                id="proposal-model"
                label="Model"
                required
                disabled={props.proposalModelDisabled()}
                aria-busy={props.proposalModelDisabled() ? "true" : undefined}
                value={props.proposalSelectedModel()}
                placeholder={props.proposalModelDisabled() ? "Loading models…" : "Choose a model"}
                options={props.proposalModels()}
                onChange={props.setProposalSelectedModel}
              />
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
