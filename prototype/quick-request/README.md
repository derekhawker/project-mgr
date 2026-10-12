# Quick Request prototype

Throwaway Tauri/Rust/raw-HTML example of the shared terminal flow in [`../../docs/opencode-terminal-e2e.md`](../../docs/opencode-terminal-e2e.md), with Quick Request acceptance steps in [`../decisions/quick-request-manual-verification.md`](../decisions/quick-request-manual-verification.md).

## Run it

Requirements: Node.js/npm, Rust/Cargo, the Linux Tauri/WebKitGTK development packages, and the user's existing `opencode` CLI on `PATH` with at least one provider configured and authenticated.

From this directory:

```sh
npm install
npm run tauri -- dev
```

## Model selection

The model selector lists enabled models from the app-owned OpenCode server.
Each new request requires an explicit selection; Rust binds it to the session
when creating the session and sets it again before sending the first prompt.
The app never falls back to OpenCode's configured model. Deprecated and
disabled models are omitted, including `opencode/exo-free`, which the v2.0.27
catalog may incorrectly report as active.

On first launch, the prototype creates
`quick-request-settings.json` in Tauri's per-user app-config directory:

```json
{
  "defaultModel": "openai/gpt-6-luna"
}
```

This app-owned setting preselects the model; the selector can choose another
available model for a request. It is separate from OpenCode's own
`opencode.json` configuration. Edit `defaultModel` in that file to change the
prototype's default.

## What it does

- Starts an app-owned, password-protected `opencode serve` process in one shared Quick Requests directory under the system temporary directory, using the installed v2 API contract. Credentials are not exposed to the WebView; the server password is passed through environment variables only to the app-owned `serve` and TUI child processes that need it.
- Creates each OpenCode session through the server API with the explicitly selected model.
- Opens that session with the v2 root TUI command in a Rust-managed PTY rendered by xterm.js inside the Tauri window.
- Displays and focuses the attached TUI before sending the initial request through the API. Enter follow-ups directly into that TUI.
- Answers OpenCode's XTGETTCAP terminal query so the TUI can finish startup in xterm.js.
- Grants the main window permission to listen for PTY output/exit events; initialization reports a listener-permission failure in the status area and keeps request controls disabled.
- Reopens the latest Quick Request with a user prompt from OpenCode history without sending another prompt; empty session records are skipped.
- Keeps the server and terminals running when the window is closed; use the tray menu to show the window again or quit the prototype.

The prototype has no separate management database. OpenCode stores conversation history as usual. The shared working directory is temporary and its path appears below the request field. It may contain files created during a request.

The checked-in integration is now adapted to the installed OpenCode v2.0.27 CLI/API contract, but it remains a disposable, unvalidated prototype: no live model-backed or GUI v2 acceptance is claimed. The saved Quick Request GUI result (2+3 → 5) remains historical OpenCode 1.18.35/v1 evidence, not v2 validation. Historical v1 rationale remains in [`../decisions/opencode-terminal.md`](../decisions/opencode-terminal.md) and the handoff documents. The v2 contract is recorded in [`../../docs/opencode-v2-contract.md`](../../docs/opencode-v2-contract.md).
