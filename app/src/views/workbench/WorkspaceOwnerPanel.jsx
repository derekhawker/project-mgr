import { Button, Select, TextArea } from "@ui-lib";
import { For, Show } from "solid-js";
import styles from "./WorkspaceOwnerPanel.module.css";

export function WorkspaceOwnerPanel(props) {
  return (
    <section
      id="selected-owner"
      hidden={!props.visible()}
      classList={{ "proposal-mode": props.proposalMode() }}
    >
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
