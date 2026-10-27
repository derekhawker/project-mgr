import { For, Show } from 'solid-js';
import { Button, Input, Select, TextArea } from './ui/index.js';
import { SetupProgressPanel } from './setup-progress-list.jsx';
import { newWorkProgressDestination } from './new-work-progress.js';

export function NewWorkDialog(props) {
  const proposal = () => props.proposal();
  const progressDestination = () => newWorkProgressDestination(
    props.captureVisible(), props.reviewVisible(), proposal().workType,
  );
  const labels = () => props.workType() === 'quick_request'
    ? ['Quick Request', 'What do you want OpenCode to do?', 'New Quick Request']
    : ['Workspace', 'Describe the workspace you want to create.', 'New Workspace'];
  return <dialog id="new-work-dialog" class="workspace-dialog" classList={{ 'proposal-open': props.reviewVisible() }}
    aria-label={props.reviewVisible() ? proposal().title : labels()[2]}
    onCancel={props.onDialogCancel}>
    <div id="new-work-dialog-content" class="workspace-dialog-content">
      <section id="new-work" class="new-work" hidden={!props.captureVisible()} aria-labelledby="new-work-title">
        <form id="new-work-capture" class="new-work-dialog-layout" onSubmit={props.onCapture} onKeyDown={props.onEnterToSubmit}>
          <div class="new-work-dialog-scroll">
            <p id="new-work-kind" class="eyebrow">{labels()[0]}</p><h1 id="new-work-title">{labels()[2]}</h1>
            <p id="new-work-guidance">{labels()[1]}</p>
            <label id="new-work-prompt-label" for="new-work-prompt">Original prompt</label>
            <TextArea id="new-work-prompt" required rows="3" placeholder="Describe the workspace" value={props.prompt()} onInput={(event) => props.setPrompt(event.currentTarget.value)} />
            <Show when={progressDestination() === 'capture'}>
              <SetupProgressPanel visible={props.progressVisible} rows={props.progressRows} />
            </Show>
          </div>
          <div class="new-work-dialog-footer"><p id="new-work-error" class="error-message" role="alert">{props.captureError()}</p>
            <Button type="button" id="new-work-cancel" onClick={props.onCancel}>Cancel</Button><Button variant="primary" type="submit" disabled={props.captureDisabled()}>Continue</Button>
          </div>
        </form>
      </section>
      <section id="new-work-review" class="new-work-review new-work-dialog-layout" hidden={!props.reviewVisible()} aria-labelledby="proposal-title">
        <div class="new-work-dialog-scroll">
          <p class="eyebrow">Review proposal</p><h1 id="proposal-title">{proposal().title}</h1>
          <div id="workspace-review-form" class="workspace-review-form" hidden={proposal().workType !== 'workspace'}>
            <label for="workspace-review-name">Workspace name</label><Input id="workspace-review-name" type="text" required maxlength="120" value={props.workspaceName()} onInput={(event) => props.setWorkspaceName(event.currentTarget.value)} />
            <label>Workspace directory</label><output id="workspace-review-directory" class="workspace-review-directory">{proposal().workspaceDirectory}</output>
            <label for="workspace-original-prompt">Original prompt</label><TextArea id="workspace-original-prompt" rows="3" readOnly value={proposal().originalPrompt} />
          </div>
          <blockquote id="proposal-original" hidden>{proposal().originalPrompt}</blockquote>
          <section id="proposal-repository-section" hidden={proposal().workType === 'quick_request'}><h3>Repositories</h3><ul id="proposal-repositories" class="proposal-repository-list" /></section>
          <section id="proposal-starting-prompt" class="proposal-starting-prompt" hidden={proposal().workType !== 'workspace'}>
            <label for="proposal-prompt">Starting prompt</label><TextArea id="proposal-prompt" rows="4" value={props.startingPrompt()} onInput={(event) => props.setStartingPrompt(event.currentTarget.value)} />
          </section>
          <Show when={progressDestination() === 'workspace'}>
            <SetupProgressPanel visible={props.progressVisible} rows={props.progressRows} />
          </Show>
          <div id="quick-request-directory-review" hidden={proposal().workType !== 'quick_request'}>
            <h2>Confirm working directory</h2><h3>Original prompt</h3><blockquote id="quick-request-original">{proposal().originalPrompt}</blockquote>
            <p>The original prompt will be sent unchanged after confirmation.</p>
            <label for="quick-request-directory">OpenCode working directory</label>
            <Select id="quick-request-directory" value={props.directoryId()} onChange={props.onDirectoryChange}>
              <option value="">Shared default Quick Request directory</option>
              <For each={props.directories()}>{(repository) =>
                <option value={repository.id}>{repository.name} — {repository.repositoryPath}</option>
              }</For>
            </Select>
            <p id="quick-request-directory-path">{props.directoryPath()}</p>
          </div>
          <Show when={progressDestination() === 'quick_request'}>
            <SetupProgressPanel visible={props.progressVisible} rows={props.progressRows} />
          </Show>
          <div class="proposal-model-field"><label for="proposal-model">Model</label>
            <Select id="proposal-model" required disabled={props.proposalModelDisabled()} aria-busy={props.proposalModelDisabled() ? 'true' : undefined} value={props.proposalSelectedModel()} onChange={(event) => props.setProposalSelectedModel(event.currentTarget.value)}>
              <For each={props.proposalModels()}>{(model) => <option value={model.value}>{model.label}</option>}</For>
              <Show when={props.proposalModelDisabled()}><option value="">Loading models…</option></Show>
            </Select>
          </div>
        </div>
        <div class="new-work-dialog-footer">
          <Button type="button" id="proposal-cancel" onClick={props.onCancel}>Cancel</Button>
          <Button type="button" id="proposal-back" onClick={props.onBack}>Back</Button>
          <Button variant="primary" type="button" id="proposal-create" disabled={props.proposalCreateDisabled()} onClick={props.onConfirm}>{proposal().createLabel}</Button><p id="proposal-error" class="error-message" role="alert">{props.proposalError()}</p>
        </div>
      </section>
    </div>
  </dialog>;
}
