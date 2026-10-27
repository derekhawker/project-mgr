import { CommandResult } from './command-result.jsx';

export function ApplicationShellStatus({ state }) {
  return <>
    <span id="app-version">{state().version}</span>
    <div class="card-heading">
      <div>
        <p class="eyebrow">Application status</p>
        <h2 id="connection-title">Rust core connection</h2>
      </div>
      <span id="connection-indicator" class="status-indicator" aria-hidden="true" classList={{
        'is-connected': state().connection === 'connected',
        'has-error': state().connection === 'storage-error' || state().connection === 'disconnected',
      }}></span>
    </div>
    <p id="connection-status" class="connection-status" role="status" aria-live="polite">{state().message}</p>
    <div class="response-panel" id="response-panel-root">
      <CommandResult message={() => state().result} />
    </div>
  </>;
}
