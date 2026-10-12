# OpenCode v2.0.27 compatibility with Quick Request

**Research date:** 2026-10-12  
**Scope:** Installed OpenCode v2.0.27 CLI/server/TUI against the v1.18.35-era `prototype/quick-request/` contract. This note records compatibility research only; it does not change the approved product boundary or clear the live integration gate.

## Finding

There is a source-supported v2 path that appears to fit the approved boundary: Rust can own a foreground `opencode serve` child bound to loopback, create sessions through the v2 API with an explicit directory, and launch the normal TUI as a PTY child using root `--server` and `--session` options. The TUI then connects to that exact server instead of asking OpenCode to use its managed background service.

The prototype as written is **not v2-compatible**: it checks for and launches the missing `attach` command, uses v1 routes and response shapes, and sends the v1 prompt body. Source inspection establishes a migration path, not actual v2 runtime/Wayland acceptance. Keep the handoff blocker open until implementation and manual checks pass.

The reviewed source is the official [`v2.0.27` tag](https://github.com/anomalyco/opencode/tree/v2.0.27), which resolves to commit `1f4d07a4a519185955ae8ab2ea3607805509e386` ([tag ref](https://api.github.com/repos/anomalyco/opencode/git/refs/tags/v2.0.27)).

## Locally observed

The installed binary is `/home/derekhawker/.opencode/bin/opencode`; `opencode --version` printed `opencode v2.0.27`.

Relevant local `opencode --help` output:

```text
FLAGS
  --standalone            Run with a private server instead of the background service
  --server string         Connect to a server URL instead of the background service
  --session, -s string    Session ID to continue, or to create if it does not exist
SUBCOMMANDS
  ...
  mini                   Start the minimal interactive interface
  run                    Run OpenCode with a message
  session                Manage sessions
  serve                  Start the v2 API and web server
```

There is no `attach` subcommand in that output. Running `opencode attach --help` printed the root help again, with no attach-specific usage and no `--dir` flag, so the prototype's current startup check rejects this installation. `opencode serve --help` showed `--hostname`, `--port`, `--cors`, `--service`, and `--stdio`; `--service` and `--stdio` are optional flags, not required for an ordinary HTTP server. `opencode mini --help` is a separate minimal UI; it is not the root full TUI command.

The prototype's Rust source confirms the v1 assumptions: startup validates `opencode attach --help`, server health calls `/global/health`, session create/list/message use unprefixed `/session` routes, the first prompt calls `/session/{id}/prompt_async`, and PTY launch is `opencode attach <url> --dir <dir> --session <id>` ([prototype Rust source](../quick-request/src-tauri/src/lib.rs), [README](../quick-request/README.md)).

## v2 process ownership and TUI invocation

- The v2 CLI root command defines `--server`, `--standalone`, and `--session`, but no `attach` command ([tagged CLI command spec](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/commands/commands.ts)). The root handler changes to the optional positional directory, resolves the specified server, then starts the normal TUI and passes it the exact session ID ([root handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/commands/handlers/default.ts)).
- A candidate full-TUI command for a known session is:

  ```sh
  opencode --server http://127.0.0.1:<port> --session <exact-session-id> <session-directory>
  ```

  The positional directory is the CLI's working directory; the session's persisted API `location.directory` is authoritative. The CLI checks whether `--session` exists on the selected server; if it does not, it treats the supplied ID as a **new session ID**, rather than treating absence as a guaranteed attach error ([root handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/commands/handlers/default.ts), [session-target resolution](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/session-target.ts)). Therefore, check the exact session via the API before launching a resume TUI and never send the initial prompt on restore.
- `--server` explicitly selects a URL and bypasses normal background-service discovery. `--server` and `--standalone` cannot be combined. Without either option, the root handler resolves OpenCode's managed service by default ([server connection](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/services/server-connection.ts)). For this app, use the explicit app-owned URL; do not rely on default CLI service behavior. `--standalone` is not the route for making multiple TUI clients share the app's already-running API server.
- The v2 `serve` handler selects `mode: "default"` unless `--service` or `--stdio` is explicitly supplied ([serve handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/commands/handlers/serve.ts)). In default mode the server process remains in the foreground; service mode instead registers with the managed service machinery and waits on service shutdown ([server process](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/server-process.ts), [server runtime](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/process.ts)). Thus, an app-launched `opencode serve --hostname 127.0.0.1 --port <port>` child (without `--service`) is a plausible privately owned server process, not an independently managed background service.
- A Tauri-owned server should bind loopback, be tracked as a child, and be explicitly stopped and waited for on full quit. v2's default server requires a password: the CLI accepts `OPENCODE_PASSWORD` or `OPENCODE_SERVER_PASSWORD`; if neither is supplied, it generates a password and prints it for the foreground server ([CLI environment](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/env.ts), [server process](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/server-process.ts)). Prefer a generated per-process secret supplied to the server and TUI children, and send authenticated Basic requests as user `opencode`; do not expose it to the WebView. The server reports readiness, version, PID, and URLs through `GET /api/info` ([server API schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/server.ts), [server handler/runtime](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/process.ts)). The v2 CLI only warns and continues if an explicit remote server reports another version, so the application must enforce its own version match ([server connection](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/services/server-connection.ts)).

The v2 experimental persistent-PTY routes are not a boundary-preserving shortcut: their implementation starts `opencode-pty` detached and unreferences it ([persistent-PTY API](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/persistent-pty.ts), [daemon implementation](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/core/src/persistent-pty/daemon.ts)). Keep the prototype's PTY/TUI children app-owned instead; do not adopt that daemon absent an explicit decision.

## v2 API and directory/session contract

The v2 API is under `/api`; it is not compatible with the prototype's unprefixed v1 routes.

| Purpose | v2.0.27 contract | Source |
|---|---|---|
| Readiness/version | `GET /api/info`; reports server identity and readiness response | [server schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/server.ts), [server runtime](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/process.ts) |
| Create session | `POST /api/session` JSON including `location: { "directory": "/absolute/path" }`; success wraps the session as `{ "data": ... }` | [session schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts), [session handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/session.ts) |
| List sessions | `GET /api/session?directory=<absolute-path>`; success is `{ data, cursor }`, and each returned session has `location.directory` (not the v1 top-level `directory`) | [session schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts), [session handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/session.ts) |
| Read exact session | `GET /api/session/{sessionID}`; session-scoped routes resolve the session's stored location | [session schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts), [session-location middleware](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/middleware/session-location.ts) |
| Read history | `GET /api/session/{sessionID}/message` returns `{ data, cursor }` and is paginated | [message schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/message.ts), [message handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/message.ts) |
| Send prompt | `POST /api/session/{sessionID}/prompt`; payload uses `text` and related prompt fields, and the route durably admits input and schedules execution by default. There is no v1 `/prompt_async` route in this schema. | [session schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts), [session handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/session.ts) |

For session creation, always pass `location.directory` explicitly. If omitted, the v2 handler falls back to the **server process's current working directory**; a client's TUI directory flag/argument does not retroactively set the location of an API-created session ([session handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/session.ts)). The API can therefore support multiple Quick Requests in their one shared directory and other sessions in distinct directories on one app-owned server, while SQLite associates each owner with the exact returned ID. Do not select an active request by “newest session” when an exact association exists.

## Status, event recovery, and pending input

- `GET /api/event` is the general SSE stream. Its schema explicitly calls it **volatile**: slow-consumer overflow fails the stream and disconnects miss events ([event schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/event.ts), [event handler/feed](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/event.ts)). It is useful for live updates, not a durable cursor by itself.
- v2 emits `session.status` with `busy`, `idle`, or `retry` states ([status schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/schema/src/session-status-event.ts)). `GET /api/session/active` lists running foreground session drains owned by that server process, and its schema explicitly says absent sessions are **inactive**, not complete ([session schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts), [session handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/session.ts)). Durable events include execution `started`, `succeeded`, `failed`, and `interrupted` ([session event schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/schema/src/session-event.ts)). An `idle` or absent session alone must not be mapped to “completed.”
- `GET /api/experimental/session/{sessionID}/log?after=<seq>&follow=true` provides the experimental per-session durable log: `after` is an exclusive sequence cursor, and a `log.synced` marker marks replay-to-live catch-up ([session schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts), [event-log schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/schema/src/event-log.ts), [session handler](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/session.ts)). It contains durable session events, not every ephemeral live token/status event. On reconnect, combine it with current active status, exact session info/messages as needed, and pending-input queries; report uncertainty if those signals do not settle the state.
- Pending permissions can be inspected at `GET /api/session/{sessionID}/permission`; pending forms at `GET /api/session/{sessionID}/form`, with form state available at `GET /api/session/{sessionID}/form/{formID}` (`pending`, `answered`, or `cancelled`) ([permission schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/permission.ts), [session/form schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts), [form schema](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/schema/src/form.ts), [handlers](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/server/src/handlers/permission.ts)). These routes and the durable session log are marked experimental in the tagged schemas. They are recovery/status evidence only under the approved product boundary: continue to show and answer work through OpenCode's real TUI, not an API-rendered transcript or replacement interaction UI.

## Process shutdown and current prototype gap

The approved owner is the Tauri/Rust process: on full quit it must stop accepting work, stop each attached TUI/PTY, wait for those children, then stop and wait for its app-owned `serve` process. The prototype's current `AppState::drop` kills TUI children without waiting for them, while it kills **and waits** for the server; the tray Quit handler immediately calls `app.exit(0)` ([prototype Rust source](../quick-request/src-tauri/src/lib.rs)). This is not evidence of complete TUI cleanup. Implement explicit, awaited shutdown and manually check for orphans rather than relying only on Rust/Tauri state destruction.

## Unknowns and required manual checks

These checks are still open; none was performed as part of this source review:

1. In the target Wayland session, start `opencode serve` as a direct child with loopback binding and an app-provided secret. Verify `/api/info` becomes ready, reports v2.0.27, and no `opencode service`/shared background server is started. Confirm the app can discover the actual bound URL without a port race.
2. Create a session with explicit shared Quick Requests `location.directory`; inspect the v2 `{data: ...}` response and confirm the exact directory and ID through session GET/list. Verify a second session in that same directory remains separately associated.
3. Launch the full TUI (not `mini`) in a Rust PTY using `--server`, exact `--session`, and that directory. Verify saved history visibly restores, prompt count does not change on restore, and a missing session is rejected before TUI launch (the CLI may otherwise create the supplied ID).
4. With a long model-backed prompt, verify the TUI is visibly ready before the API prompt is sent, the v2 `/prompt` request streams into that terminal, and a follow-up stays in the same session. Verify approvals and every relevant user-input/form case are recoverable and answerable in the actual TUI.
5. Disconnect/reconnect event listeners during execution. Confirm volatile `/api/event` loss is reconciled using the durable session log, active state, pending permission/form checks, and history; confirm `inactive`/`idle` alone never reports completion. Confirm durable log cursor replay is available and usable in this installed build.
6. Hide/reopen the terminal and app window while work runs; then fully quit. Verify hidden work continues, and on quit every TUI/PTY and server child exits and no detached/shared service remains. Record any process-group or signal escalation needed.
7. Confirm the local executable's provenance/build is the same source represented by the `v2.0.27` tag. The local `--version` output establishes its version string, not a binary hash or signed-artifact match.

Until these checks pass and the version-specific compatibility instructions are deliberately updated, treat all earlier v1.18.35 GUI evidence as historical only.
