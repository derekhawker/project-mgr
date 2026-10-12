# OpenCode v2.0.27 integration contract

**Research date:** 2026-10-12. **Installed binary:** `opencode v2.0.27` at
`/home/derekhawker/.opencode/bin/opencode`.

This preserves the v1 prototype evidence and the approved process ownership in
[`.opencode-handoff.md`](../.opencode-handoff.md). This file records v2 facts.

## Local CLI and server findings

Commands run:

```sh
command -v opencode
opencode --version
opencode --help
opencode serve --help
opencode attach --help       # absent; parsed as the root CLI and exits nonzero
```

Observed app-owned server command:

```sh
OPENCODE_SERVER_PASSWORD='secret' \
  opencode serve --hostname 127.0.0.1 --port 4101
```

The server reports identity/readiness at `GET /api/info` (not
`/global/health`):

```json
{"version":"2.0.27","pid":123,"urls":["http://127.0.0.1:4101"],
 "paths":{"tmp":"/tmp/opencode"},"capabilities":{"persistentPty":true}}
```

With a password configured, API calls use HTTP Basic authentication with user
`opencode` and the configured password. The local server returned `401` for
`/openapi.json` without credentials and `200` with them. The local generated
schema is also published at [`opencode.ai/v2/openapi.json`](https://opencode.ai/v2/openapi.json).

The root TUI is invoked against the already-owned server, directory, and exact
session:

```sh
opencode --server http://127.0.0.1:4101 --session "$SESSION_ID" "$DIRECTORY"
```

`--standalone` makes the CLI run with a private server, but that server would
be owned by the TUI process rather than the Tauri/Rust app. Do not use it for
the approved boundary. There is no v2 `opencode attach` subcommand.

## API routes and payloads

All paths include `/api`; successful responses are generally wrapped in
`{"data": ...}`.

| Purpose | v2 route and contract |
|---|---|
| Health/identity | `GET /api/info`; returns `version`, `pid`, `urls`, `paths.tmp`, and optional capabilities. Use it as the startup gate. |
| Models | `GET /api/model`; response wraps the model catalog in `data`. Select only enabled, non-deprecated models. |
| Create | `POST /api/session`, body `{"title":"...","location":{"directory":"/absolute/path"},"model":{"providerID":"openai","id":"gpt-6-luna"}}`; response `{"data":{"id":"ses_...", "location":...}}`. |
| Set session model | `POST /api/session/{sessionID}/model`, body `{"model":{"providerID":"openai","id":"gpt-6-luna"}}`; use this to bind the chosen model before the first prompt. |
| List | `GET /api/session?directory=<absolute>&order=desc&limit=50`; also supports `project`, `subpath`, `parentID`, `search`, and opaque `cursor`; response has `data` and `cursor.{previous,next}`. |
| History | `GET /api/session/{sessionID}/message?order=asc&limit=...`; response has `data` and cursors; `type=user` or `type=assistant` filters before pagination. |
| Prompt | `POST /api/session/{sessionID}/prompt`, body requires `text`; optional `id`, `files`, `agents`, `skills`, `metadata`, `delivery`, `resume`. The prompt route does not accept a model, so set the session model explicitly first. v2 has no `prompt_async` route in the schema. |
| Status | `GET /api/session/active` returns `data` mapping active IDs to `{"type":"running"}`. Absence means inactive, not completed; session records may expose `outcome: succeeded`, `failed`, or `interrupted`. |
| Volatile events | `GET /api/event`, SSE; disconnects can lose events. |
| Durable events | `GET /api/experimental/session/{sessionID}/log?after=<exclusive-seq>&follow=true`, SSE; experimental cursor replay plus live follow. |
| Permissions | `GET /api/session/{sessionID}/permission`; reply with `POST /api/session/{sessionID}/permission/{requestID}/reply`, body `{"decision":"once"}` (`always`/`reject` also valid, optional `message`). |
| Forms | `GET /api/session/{sessionID}/form`; inspect `GET .../form/{formID}`; reply `POST .../form/{formID}/reply`, body `{"answer":{"fieldId": value}}`; cancel with `DELETE .../form/{formID}`. |

The canonical v2 session source defines the routes and semantics in
[`packages/protocol/src/groups/session.ts`](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts);
model catalog routes and response shape are defined in
[`packages/protocol/src/groups/model.ts`](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/model.ts),
and model references in
[`packages/schema/src/model.ts`](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/schema/src/model.ts);
permission routes are in
[`permission.ts`](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/permission.ts),
and events in
[`event.ts`](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/event.ts).

## Directory and session rules

For every new session, send the absolute directory in `location.directory`,
store the returned session ID, and later query/attach by both that ID and the
recorded directory. This is required for multiple Quick Requests sharing one
directory; “newest session” is only a disposable recovery fallback without a
durable association. Do not use `/api/session/active` as a completion test.
On reconnect reconcile the session record, active map, pending permissions/forms,
and (where acceptable) the experimental durable log.

## Prototype adaptation and boundary decision

The disposable prototype's code adaptation to the installed v2.0.27 seam is
implemented without adding a daemon. It starts an app-owned `opencode serve`
child, uses authenticated `/api/...` routes and `data` response wrappers,
loads an app-owned per-user model setting (default `openai/gpt-6-luna`), lists
available models, requires a user-selected model, creates sessions with both
`location.directory` and that model, and explicitly sets the model again before
the initial prompt. It excludes deprecated/disabled catalog entries and the
known stale `opencode/exo-free` entry. Rust launches the root TUI with the exact
server, session, and directory. It owns the server password and API client,
passes the password only to the app-owned server and TUI child processes that
need it, and does not expose it to the WebView. This is code adaptation, not
live model-backed/TUI acceptance or GUI acceptance. The separate isolated
server/API smoke is recorded below.

The Rust prototype test suite passes 15 tests. Its model tests cover settings
creation/override, invalid defaults, catalog filtering, required explicit
selection, and v2 session/prompt payloads. Restore-selection unit
coverage checks these cases: require an exact `location.directory` match, skip
a newer empty session, select the newest populated matching session, and ignore
a populated session from another directory. Linux-only lifecycle tests also
cover duplicate-terminal cleanup and reaping tracked and pre-registration
direct children. These unit tests do not exercise a live model-backed v2 TUI or
GUI.

The local `/api/model` response reported `opencode/exo-free` as active even
though the user-observed prompt error said that model had been deprecated. The
prototype explicitly blocks that known stale entry in addition to filtering
catalog status and enabled flags; this workaround should be revisited when the
server catalog is corrected.

Its existing Rust-owned `serve` child and Rust-managed PTY fit the
no-independent-background-server/no-extra-daemon rule. Do **not** use the
default CLI background service, `opencode service`, or the v2 experimental
persistent-PTY API as the default: it advertises `persistentPty` and uses an
`opencode-pty` helper process, outside the initial ownership boundary.

## Blockers and unknowns

1. The adapted application path has not had an end-to-end run against the live
    v2 API/TUI. Isolated server/API smokes verified `/api/info`, model listing,
    explicit-model session creation/switch, exact directory readback, and empty
    history without a prompt; they did not launch the prototype TUI. Manual
    Wayland acceptance has not occurred. Model-backed streaming, same-session follow-up,
    approval/form answers, two sessions in one directory, and GUI history
    restoration remain open.
2. The exact v2 TUI readiness barrier before the first `POST /api/session/{id}/prompt`
   is not established; the prototype's short delay and child-alive check are
   not a readiness contract.
3. Event recovery remains unvalidated. The general event stream is volatile
   and durable session-log replay is experimental; running/waiting/completed
   labels need validation from observed v2 events plus pending-request state.
4. Password provisioning and lifetime still need production-Rust validation;
   credentials must stay out of the WebView. The current prototype's
   Rust-managed credentials do not establish production behavior.
5. The prototype now has an explicit shutdown path that stops and waits for its
    tracked TUI/PTY and server direct children; Linux unit tests cover the
    shutdown helper and pre-registration cleanup guards. The tests do not
    exercise the live Tauri tray callback, descendant/process-group cleanup, or
    manual Wayland lifecycle. `persistentPty` is exposed locally, but its
    helper-daemon lifecycle is out of bounds unless the no-extra-daemon decision
    is explicitly reopened.

## Primary sources and local evidence

* [v2 CLI source](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/cli/src/commands/commands.ts)
  defines root `--server`, `--session`, `--standalone`, and `serve`; it has no
  `attach` command.
* [v2 session protocol source](https://github.com/anomalyco/opencode/blob/v2.0.27/packages/protocol/src/groups/session.ts)
  owns route and payload definitions.
* [v2 OpenAPI schema](https://opencode.ai/v2/openapi.json) and local
  authenticated `GET /openapi.json` verify installed paths, wrappers,
  parameters, and response shapes.
* Local commands above observed `opencode v2.0.27`, root help, `/api/info`,
  authenticated `/api/session`, and authenticated `/openapi.json`.
* An isolated smoke launched `opencode serve` as a foreground child under
  temporary `HOME`/XDG directories, verified `/api/info` reported `2.0.27`,
  created and fetched an empty session at an explicit temporary directory, and
  terminated and waited for the server child. No prompt was sent. This confirms
  a direct server/API path only; it does not validate the Rust prototype, TUI,
  GUI, or descendant-process cleanup.
* A second isolated API smoke used the same temporary-directory boundary,
  listed 10 enabled/non-deprecated choices, created a session with an explicit
  listed model, received HTTP 204 from `POST /api/session/{id}/model`, and
  confirmed the message history remained empty. It made no model request and
  did not test the app picker, configured Luna provider, TUI, or GUI.
* Historical v1 rationale remains in
  [`prototype/decisions/opencode-terminal.md`](../prototype/decisions/opencode-terminal.md)
  and [`prototype/quick-request/README.md`](../prototype/quick-request/README.md);
  their `attach`, unprefixed `/session`, and `prompt_async` claims are not v2
  facts.
