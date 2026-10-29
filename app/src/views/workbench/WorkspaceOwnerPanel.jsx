import { Button, Collapsible, Select, TextArea } from "@ui-lib";
import { For, Show } from "solid-js";
import styles from "./WorkspaceOwnerPanel.module.css";

export function WorkspaceOwnerPanel(props) {
  return (
    <section
      id="selected-owner"
      hidden={!props.visible()}
      classList={{ "proposal-mode": props.proposalMode() }}
    >
      <Collapsible class="owner-management" label="Workspace options">
        <div class="owner-management-content">
          <div class="workspace-actions">
            <label for="attach-repository-select">Repository</label>
            <Select
              id="attach-repository-select"
              aria-label="Repository to attach"
              value={props.selectedAttachRepository()}
              onChange={props.onAttachRepositoryChange}
            >
              <option value="">Select an enabled repository</option>
              <For each={props.attachRepositoryOptions()}>
                {(option) => <option value={option.id}>{option.label}</option>}
              </For>
            </Select>
            <Button
              id="attach-repository"
              type="button"
              hidden={props.quickRequest()}
              disabled={props.attachRepositoryDisabled()}
              onClick={props.onAttachRepository}
            >
              Attach repository
            </Button>
            <Button
              id="complete-workspace"
              type="button"
              hidden={props.quickRequest()}
              disabled={props.completeWorkspaceDisabled()}
              onClick={props.onCompleteWorkspace}
            >
              Complete workspace
            </Button>
            <Button
              id="reactivate-workspace"
              type="button"
              hidden={props.quickRequest()}
              disabled={props.reactivateWorkspaceDisabled()}
              onClick={props.onReactivateWorkspace}
            >
              Reactivate workspace
            </Button>
          </div>
          <div id="owner-repository-context" class="owner-repository-context">
            <span>Workspace repositories</span>
            <ul
              id="attached-repositories"
              aria-label="Repositories attached to workspace"
            >
              <Show
                when={props.repositories().length > 0}
                fallback={<li>None attached</li>}
              >
                <For each={props.repositories()}>
                  {(repository) => (
                    <li title={repository.checkoutPath}>{repository.label}</li>
                  )}
                </For>
              </Show>
            </ul>
          </div>
          <form
            id="workspace-session-form"
            class={styles.requestForm + " " + styles.workspaceSessionForm}
            hidden={props.quickRequest()}
            onSubmit={props.onWorkspaceSessionSubmit}
            onKeyDown={props.onEnterToSubmit}
          >
            <label for="workspace-prompt">Workspace planning prompt</label>
            <TextArea
              id="workspace-prompt"
              rows="2"
              placeholder="Inspect the workspace and plan the next step"
              value={props.workspacePrompt()}
              onInput={(event) =>
                props.onWorkspacePromptInput(event.currentTarget.value)
              }
            />
            <Button
              id="workspace-session-submit"
              type="submit"
              variant="primary"
              disabled={
                props.workspaceSessionSubmitDisabled() ||
                props.terminalRuntimeStartupFailed()
              }
            >
              Start workspace session
            </Button>
          </form>
        </div>
      </Collapsible>
      <p id="workspace-description" class="visually-hidden">
        {props.description()}
      </p>
      <p
        id="workspace-status"
        class="workspace-status"
        role="status"
        aria-live="polite"
      >
        {props.status()}
      </p>
      <section
        id="pending-starting-prompt"
        hidden={!props.pendingPromptVisible()}
        class="pending-starting-prompt"
      >
        <label for="pending-prompt-text">Starting prompt · not sent</label>
        <TextArea
          id="pending-prompt-text"
          rows="3"
          value={props.pendingPromptText()}
          onInput={(event) =>
            props.onPendingPromptTextInput(event.currentTarget.value)
          }
        />
        <Button
          id="submit-starting-prompt"
          type="button"
          disabled={props.pendingPromptDisabled()}
          onClick={props.onSubmitStartingPrompt}
        >
          {props.pendingPromptLabel()}
        </Button>
      </section>
      <p
        id="session-status"
        class="visually-hidden"
        role="status"
        aria-live="polite"
      >
        {props.sessionStatus()}
      </p>
      <ul
        id="pending-inputs"
        class="visually-hidden"
        aria-label="Pending input"
      >
        {props.pendingInputs?.()}
      </ul>
      <section class="terminal-card" aria-label="OpenCode terminal">
        <div
          id="terminal-views"
          class="terminal-views"
          ref={props.setTerminalViews}
        />
      </section>
      <form
        id="quick-request-form"
        class={styles.requestForm}
        hidden
        aria-busy={String(props.quickRequestBusy())}
        onSubmit={props.onQuickRequestSubmit}
        onKeyDown={props.onEnterToSubmit}
      >
        <label for="quick-prompt">Prompt</label>
        <TextArea
          id="quick-prompt"
          required
          rows="4"
          aria-describedby="quick-error"
          placeholder="What should OpenCode help with?"
          value={props.quickPrompt()}
          onInput={(event) =>
            props.onQuickPromptInput(event.currentTarget.value)
          }
        />
        <div class={styles.modelRow}>
          <label for="quick-model">Model</label>
          <Select
            id="quick-model"
            required
            aria-describedby="quick-error"
            aria-busy={String(props.modelBusy())}
            disabled={props.modelDisabled()}
            value={props.selectedModel()}
            onChange={props.onModelChange}
          >
            <Show
              when={props.modelOptions().length}
              fallback={
                <option value="">
                  {props.modelError()
                    ? "Models unavailable"
                    : "Loading models…"}
                </option>
              }
            >
              <For each={props.modelOptions()}>
                {(option) => (
                  <option value={option.value}>{option.label}</option>
                )}
              </For>
            </Show>
          </Select>
        </div>
        <Button
          id="quick-submit"
          type="submit"
          variant="primary"
          disabled={
            props.quickRequestBusy() ||
            props.modelDisabled() ||
            props.modelError() ||
            props.terminalRuntimeStartupFailed()
          }
        >
          Start Quick Request
        </Button>
        <p id="quick-error" class="error-message" role="alert">
          {props.quickRequestError()}
        </p>
      </form>
    </section>
  );
}
