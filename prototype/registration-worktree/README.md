# Registration/worktree boundary prototype

This is a disposable Rust experiment for the P-00 registration boundary. It is
not production persistence and it does not create an OpenCode server, a second
background service, or a conversation transcript. The boundary keeps an
in-memory record of reports and associations; Git remains the source of truth
for repository, branch, worktree, and cleanliness facts.

## Run it

Requirements: Rust/Cargo and Git. The tests create isolated repositories below
temporary directories, inspect their paths and branches, and remove the
temporary fixture directories at the end.

```sh
cargo test --manifest-path prototype/registration-worktree/Cargo.toml
```

The MCP protocol test covers `initialize`, `tools/list`, and `tools/call`,
including malformed arguments, an unknown caller session, and a valid mixed
report. Run the isolated OpenCode discovery/protocol smoke with:

```sh
prototype/registration-worktree/mcp-smoke.sh
```

The script creates a temporary Git project and `opencode.json`, starts an
app-owned `opencode serve` child, optionally asks the installed CLI to discover
the local MCP server with `opencode mcp list`, and then performs the protocol
exchange. It uses no user config or conversation history. The protocol exchange
is deterministic and does not invoke a model; `opencode mcp list` is discovery,
not tool invocation.

To run the opt-in live OpenCode v2.0.27 path (with the explicit default model
shown below), use:

```sh
LIVE_MODEL=1 MODEL=openai/gpt-6-luna sh prototype/registration-worktree/mcp-smoke.sh
```

This runs `opencode run --server ... --session ... --model ...` in the temporary
project, with the local MCP server configured, and prompts the model to invoke
`register_task_setup` with the prepared report. The script captures OpenCode
stdout/stderr and MCP server evidence, and only claims success when the server
records that tool call and a non-error returned result containing
`setup-op-live`. The fixture uses the exact session ID passed to `opencode run`,
so Rust ownership validation is unchanged. `MODEL=provider/model` and
`LIVE_TIMEOUT=seconds` may be overridden. This mode requires an authenticated,
available provider and model; provider/auth failures, unavailable models,
timeouts, and nondeterministic model tool selection fail the command rather than
producing a success claim.

The local server can also be run directly after preparing a context JSON (see
`mcp_protocol.rs`):

```sh
cargo run --manifest-path prototype/registration-worktree/Cargo.toml \
  --bin registration-mcp -- --context /absolute/path/context.json
```

Its stdio transport is newline-delimited JSON-RPC, the stable local MCP path
documented by the installed OpenCode v2.0.27 CLI (`opencode mcp --help`).
`--context` is a disposable prototype fixture that preloads the existing
`RegistrationBoundary`; it is not persistence and does not replace the
application's future SQLite command boundary.

To run the executable child-process demonstration (the installed OpenCode
v2.0.27 CLI does not expose arbitrary registration tools as a stable local
command), run:

```sh
cargo run --manifest-path prototype/registration-worktree/Cargo.toml --bin registration-bridge -- cargo run --quiet --manifest-path prototype/registration-worktree/Cargo.toml --bin registration-fixture
```

`registration-fixture` is a deterministic OpenCode-tool stand-in; this is not
live model-backed OpenCode evidence. The bridge creates Git fixtures, sends one
JSON request on the child stdin, reads exactly one `RegistrationReport` JSON
value from child stdout, deserializes it, passes it to `RegistrationBoundary`,
and prints the serialized `RegistrationResult` on its stdout. The child command
contract is therefore:

```text
stdin:  one JSON request (implementation-defined setup context)
stdout: one JSON RegistrationReport, with no logging or other stdout
```

The report fields and item result/error rules are the JSON shape below. A child
exit failure or malformed stdout is rejected before the in-memory boundary is
mutated. A real OpenCode/tool command can replace the fixture command when it
supports this stdin/stdout contract.

## Report payload

The input and returned item shape is:

```json
{
  "operation_id": "setup-op-1",
  "workspace_id": "workspace-1",
  "task_id": "task-1",
  "session_id": "session-setup-1",
  "items": [
    {
      "item_id": "repo-a-worktree",
      "repository_id": "repo-a",
      "repository_path": "/canonical/repository",
      "git_identity": "/canonical/repository/.git",
      "branch": "task-1-repo-a",
      "worktree_path": "/canonical/task/worktrees/repo-a",
      "result": "ready",
      "error_code": null,
      "detail": null
    }
  ]
}
```

`result` is `ready`, `failed`, or `not_attempted`. Failed and not-attempted
items carry a machine-readable `error_code` and human-readable `detail`.
Returned reports retain workspace, task, session, operation, and every item.

## Executable evidence

The Rust tests use real Git repositories and cover:

- exact caller session, active workspace/task ownership, catalog identity, and
  canonical repository path checks;
- branch existence, registered worktree existence, branch/worktree agreement,
  task worktree containment, and conflicting active ownership;
- multiple repositories in one report, mixed `ready`/`failed`/`not_attempted`
  outcomes, independent persistence, and returned per-item results;
- same-content operation replay as a no-op and different-content reuse of an
  operation ID as `operation_mismatch`;
- read-only report validation, including proof that invalid reporting does not
  delete Git paths or branches;
- cleanup classification for clean unused, dirty/new-file, and in-use
  worktrees. Only a clean unused worktree is removed, and its branch remains;
- an external conversation-history fixture that is unchanged by registration,
  plus a boundary snapshot containing associations/results but no messages or
  service state. The experiment performs no OpenCode process or server startup.

Cleanup is explicit and only permitted after the fixture task is completed.
The in-use classification comes from the recorded session worktree, not a
mocked Git result. Dirty/new-file and in-use worktrees remain on disk.
Validation never performs cleanup; Git deletion occurs only in the explicit
clean-unused cleanup call.

The model-backed Quick Request model-selection, streaming/follow-up, and
approval/question GUI checks remain the existing manual acceptance in
`prototype/decisions/quick-request-manual-verification.md`; this Rust-only
experiment cannot provide that evidence. Those checks require a Linux Tauri
WebKitGTK environment, a display, the installed OpenCode v2.0.27 CLI, and an
authenticated provider, then the existing manual sequence (`npm install` once
and `npm run tauri -- dev` from `prototype/quick-request/`).
