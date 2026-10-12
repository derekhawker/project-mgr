# OpenCode embedded terminal: clean-room implementation guide

This document specifies the shared terminal flow for every OpenCode session type: workspace, task, and Quick Request. It records the contracts and failure checks learned while bringing up the Tauri prototype. Session lookup and working-directory selection vary by context; PTY attachment, xterm rendering, input, resize, and terminal lifecycle should use one implementation.

**Validation status:** the disposable prototype's code is adapted to the
installed OpenCode v2.0.27 server/API/TUI contract. Its 15 Rust tests pass,
including restore selection by exact `location.directory`, skipping a newer
empty session, choosing the newest populated matching session, ignoring
another directory, and Linux direct-child shutdown/reaping checks. The Rust
unit checks also cover the app-owned default-model setting, catalog filtering,
and explicit v2 model payloads. Seven frontend tests verify Tauri command names,
the selected-model payloads, and result/error handling. These are unit checks
only: no end-to-end prototype run against the live v2 API/TUI, model-backed
flow, or v2 GUI has been validated.
Isolated temporary server/API smokes separately verified `/api/info`, model
listing, session creation with an explicit model, `POST /api/session/{id}/model`,
exact `location.directory` readback, and empty history without sending a prompt;
they did not run the prototype or launch its TUI.
Manual Wayland/v2 acceptance remains open. The saved Quick Request visibly
rendered in the built GUI with OpenCode 1.18.35; that is historical v1 evidence
only. Regular workspace/task routing, fresh-response streaming, and same-session
follow-up also remain unvalidated.

## Required outcome

- Creating or resuming any OpenCode session opens the matching interactive TUI in the GUI. For a new session, this happens before generation starts.
- The user sees the real TUI update as output arrives and can enter follow-ups in that same session.
- OpenCode remains the owner of conversation history. Do not create a second app transcript or replace the TUI with a transcript view.
- A saved session can be reopened by its exact session ID without submitting another prompt.

## Components and ownership

| Component | Responsibility |
|---|---|
| OpenCode server API | Create/list sessions, accept the initial prompt, and expose session history. |
| Session-context resolver | Resolve the correct session ID and working directory for a workspace, task, or Quick Request. |
| Rust/Tauri core | Own the app-managed OpenCode server process or processes, PTYs, session IDs, PTY input/output, and resize. |
| OpenCode root TUI | Run the full interactive TUI against the same server, directory, and session ID. |
| xterm.js | Parse and visibly render the PTY byte stream; send keyboard input back to the PTY. |
| Tauri events | Carry ordered PTY output and exit notifications from Rust to the matching frontend terminal. |

Use the installed OpenCode CLI and verify its version and command contract at startup. For the installed v2.0.27 contract, use an app-owned `opencode serve`, authenticated `/api/...` routes, and the root TUI invocation `opencode --server <url> --session <id> <directory>`. The v1 `attach`, unprefixed `/session`, and `prompt_async` forms are historical prototype evidence and must not be mixed with v2. See [`opencode-v2-contract.md`](opencode-v2-contract.md).

Every terminal attachment requires an exact session ID and its correct working directory. The application layer resolves those values: workspace sessions use workspace/main-branch context, task sessions use their task/worktree context, and Quick Requests use their shared directory. Store regular session IDs in the owning workspace/task record. Keep this routing outside the terminal renderer. Each session gets its own PTY and xterm instance; never infer a regular session from whichever conversation is foreground or newest in a directory.

## Startup gates

1. Register the `terminal-output` and `terminal-exit` listeners before enabling request submission. If either subscription fails, show the error and block the terminal workflow; do not silently continue with tabs that cannot receive output.
2. The main Tauri window needs `core:event:allow-listen` and `core:event:allow-unlisten` in its capability. Rust successfully emitting events does not grant the WebView permission to listen.
3. Check `opencode --version` and verify the matching TUI flags. For v2.0.27, root help must expose `--server` and `--session`; launch the root TUI as `opencode --server <url> --session <id> <directory>`.
4. Start or reuse an app-owned `opencode serve` child bound to `127.0.0.1` for the resolved session context. For v2.0.27, wait for authenticated `GET /api/info`, create sessions through `/api/session` with `location.directory`, and use Basic authentication from Rust. Rust passes the password only to the server and TUI child processes that need it; never expose credentials to the WebView.
5. Keep any server and PTY subprocesses owned by the Tauri process. Do not silently use OpenCode's independently managed shared background server.

## New-session flow

The order is significant; do not send an initial prompt before the terminal can receive and parse TUI output. The terminal runtime receives a resolved session ID and directory; it does not branch on workspace, task, or Quick Request type.

1. Resolve the session's owner/context, working directory, and repository/worktree environment. Validate and trim the initial prompt; create the working directory if needed.
2. Ensure the app-managed server for that context is ready, then create a session with the version-matched API. For v2.0.27, call `POST /api/session` with `location.directory`; keep the returned session ID and display title in the owning workspace/task/Quick Request record.
3. Allocate a PTY and launch the version-matched root TUI with `--server`, `--session`, and the resolved directory. Set `TERM=xterm-256color` and `COLORTERM=truecolor`; use the resolved directory as the process working directory.
4. Start reading the PTY master immediately. Emit each byte chunk as a `terminal-output` event containing `sessionId` and base64-encoded `dataBase64`. Emit a matching `terminal-exit` event when the child exits. Base64 preserves terminal control bytes and UTF-8 across the JSON event boundary.
5. In the WebView, decode each event's `payload.dataBase64` to a `Uint8Array` and write it to the xterm instance for `payload.sessionId`. If output arrives before that terminal instance exists, queue the chunks per session and replay them in order after the terminal is created.
6. Create the xterm instance, register its terminal-protocol handlers, open it in the session view, then replay queued output. Select the view, fit it to its visible container, and focus it.
7. Wait until the TUI process is alive and the output pipeline is ready before calling the version-matched prompt endpoint. For v2.0.27, call `POST /api/session/{id}/prompt` with a `text` body. The user must be able to see the TUI before generation begins. Resuming an existing session skips session creation and this initial-prompt call.
8. Continue delivering PTY output while the model responds. The terminal, not an app-generated transcript, is the visible source of the response.

The prototype currently uses a short startup delay and checks that the TUI child is alive. Treat that delay as a prototype shortcut, not a readiness contract. A clean implementation should use an explicit readiness signal or equivalent ordered barrier so the first output and terminal handshake cannot race the initial prompt. The v2 readiness check remains open.

## Required XTGETTCAP handshake

During startup, OpenCode's TUI asks for the `Ms` terminal capability using a DCS query equivalent to `ESC P + q 4d73 ST`, where ST is ESC followed by one backslash. xterm.js must register this matcher with `+` as an **intermediate** and `q` as the final byte. `+` is not a valid xterm.js DCS prefix; using it as `prefix` raises `prefix must be in range 0x3c ..0x3f` during terminal setup.

When the capability is unsupported, reply to the PTY with `ESC P 0 + r 4d73 ST`. The regression test must instantiate the real xterm.js parser, feed it the query, and assert that this reply is written. A mock parser that accepts any matcher is insufficient.

Register this handler before replaying any buffered PTY output. Surface PTY-write failures from the reply callback; otherwise the TUI can remain blank while the tab and session status appear healthy.

## Follow-up input and resize

- Forward xterm's `onData` bytes to the Rust `write_terminal` command for the same session ID. Rust writes and flushes them to that session's PTY master.
- Forward xterm's fitted column and row counts to Rust. Resize that session's PTY master so the TUI redraws for the actual visible terminal dimensions.
- Keep one PTY and one xterm instance per session. Switching tabs selects an existing session; it must not attach to a different conversation.

## Reopening saved work

1. Resolve the session using the owning context. Workspace/task sessions use the exact session ID stored in the workspace/task association and its recorded working directory. Never choose the newest session in a regular workspace or task directory.
2. Quick Requests currently share one directory and lack a durable per-request association in the prototype. Its v2 fallback lists sessions from the app-owned server, filters by exact `location.directory`, examines newest-to-oldest, and skips records with no user message. Rust unit tests cover the exact-directory and populated-session selection rules. This fallback is Quick Request-specific and must not be used for regular sessions.
3. Launch the root TUI with `--server`, the resolved exact `--session` ID, and its directory; start the same PTY-to-xterm event pipeline for every session type.
4. Render the existing TUI history. Restore does not send an initial prompt.

The GUI acceptance check is visible existing prompt/response text in the xterm surface—not merely a successful API lookup, a session tab, a running status indicator, or a TUI process. Verify that the selected session ID is the one passed to the root TUI's `--session` option and that its directory matches the session's `location.directory`; confirm the API message count is unchanged by restore.

## Window and process lifecycle

- Hiding a terminal view or closing the Tauri window hides presentation only. Keep its PTY, TUI process, server-side session, and buffered output alive.
- Reopen the existing app through its tray action. Do not start another app process to show a hidden window; duplicate app processes produce duplicate tray icons and separate terminal state. A clean implementation should enforce single-instance behavior.
- Full application quit must explicitly stop every attached TUI and the app-owned server, then wait for those children to exit. The prototype's tray Quit code now calls a shared shutdown path that waits for tracked PTY/TUI and server direct children; Linux Rust tests cover reaping those children and pre-registration cleanup guards. Those tests do not exercise the Tauri tray callback, descendants/process groups, or the manual Wayland lifecycle. Verify those separately and do not assume managed-state destruction alone is sufficient.

## Failure behavior

Show a visible error and stop the relevant flow when listener registration, server health, session creation/listing, history lookup, PTY creation/attachment, terminal writes, or TUI startup fails. In particular, a failed event subscription must not be masked by a successful session tab or API status.

Keep errors associated with the session ID. Never send the initial prompt if the exact session's PTY failed to start, and never send a prompt as part of history restoration.

## Acceptance checks

1. **Parser regression:** with real xterm.js, `DCS +q4d73 ST` registers and produces `DCS 0+r4d73 ST`; the old `prefix: '+'` matcher fails with the xterm prefix-range error.
2. **Capability regression:** the main-window capability includes event `allow-listen` and `allow-unlisten` permissions.
3. **No-generation restore:** in the built Tauri GUI, reopen a known completed session. Assert the selected ID matches the root TUI's `--session` argument, its recorded directory is exact, the xterm visibly contains its saved prompt and answer, and the API message count is unchanged.
4. **New request:** submit a sufficiently long prompt and verify output becomes visible while the response is still being produced, not only after completion. Confirm the initial prompt belongs to the session shown in that terminal.
5. **Follow-up:** enter a follow-up in xterm and verify it continues the same OpenCode session and appears in that same terminal history.
6. **Context isolation:** open workspace, task, and Quick Request sessions through the same terminal runtime. Verify each uses its resolved directory and only its own session ID/history. Include two sessions sharing a directory.
7. **Lifecycle:** hide and reopen a terminal view, hide and show the app through its tray, and verify the same session remains usable with only one app/tray instance. On full quit, verify no TUI or server child remains.

The saved-history GUI result used an existing Quick Request `2+3` session and visibly rendered the prompt and `5` without generating another model response. This is historical v1 evidence for Quick Requests only. The current v2 restore-selector unit tests are not GUI acceptance. Live v2 API/TUI behavior, model-backed streaming, follow-up behavior, regular workspace/task resolution, approval/user-input flows, event recovery, manual Wayland rendering, macOS rendering, and complete awaited quit cleanup remain open validation items.
