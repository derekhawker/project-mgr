# Ticket agent-loop model-gate experiment

This plugin automatically considers continuation for ticket-bound sessions. It
listens for session idle, binding, and lifecycle events; verifies the exact
Workspace-ticket session binding and deterministic safety gates; then asks the
session model for a strict JSON decision: `continue`, `complete`, `blocked`, or
`ask_user`. The classifier receives the latest assistant response and current
ticket content. A `continue` must name an exact unchecked item in the ticket's
`## Tasks` section;
otherwise it fails closed. Only `continue` queues a prompt. Invalid or
unavailable evidence fails closed, and ticket content plus the idle
boundary are revalidated after generation.

Existing tickets with tasks only in a legacy companion need a session turn to
move those tasks into the ticket before automatic continuation can select them.
An idle already evaluated before migration needs another session turn to wake
the gate again.

The server registers `/agent-loop-model-gate-stop`. The TUI registers
`/agent-loop-model-gate-status`, which displays the last check time, outcome,
sanitized reason, a read-only current preflight, and the last wake
event received since plugin load in a toast. Event receipts stay in memory and
store only the event type and receipt time. The plugin never stores or displays
the model's explanation, task text, event payload, or session transcript. A stop is saved in plugin storage
and prevents future automatic prompts for that session. Use a fresh disposable
session for another experiment; this prototype does not yet define a resume
action.

The plugin considers eligible sessions without a session-ID allowlist. It
does not evaluate sessions at startup; it
wakes on `session.idle`, the idle transition in `session.status`, or successful
session execution, plus ticket and session lifecycle events. The session must
belong to the current OpenCode project and workspace, and its active ticket must
name the same session ID. Worktree directories may differ.
If OpenCode's event stream ends or errors, the plugin reconnects with a bounded
backoff. The status toast reports whether that stream is listening, retrying, or
closed, alongside whether a wake event has arrived since plugin load.

## Isolated plugin configuration

`test-config/opencode.jsonc` adds this plugin and disables the existing
`project-mgr-agent-loop` by plugin ID. Use a disposable ticket-bound session
for this experiment.

Run a separate loopback server from an empty scratch directory so the test does
not reload or alter the live OpenCode server. This adapter needs an explicit
port on v2.1.4; dynamic-port `--standalone` is not supported by its read-only
session API adapter.

```sh
repo="$(git rev-parse --show-toplevel)"
scratch="$(mktemp -d /tmp/opencode/agent-loop-model-gate.XXXXXX)"
cd "$scratch"
printf 'In a second terminal: opencode --server http://127.0.0.1:49375 %s\n' "$scratch"
OPENCODE_CONFIG_DIR="$repo/opencode/plugins/agent-loop-model-gate/test-config" \
  opencode serve --hostname 127.0.0.1 --port 49375
```

In a second terminal, connect with
`opencode --server http://127.0.0.1:49375 "$scratch"`.

This overlays only plugin configuration; normal provider authentication remains
available. The scratch directory avoids scanning existing repository sessions.
Do not attach a real ticket or use an existing session for this experiment;
first create a disposable ticket-bound test session.

The prototype deliberately does **not** recover an in-flight model decision or
prompt admission across a server restart. It records the idle boundary before
calling the model and fails closed rather than retrying an uncertain admission.
OpenCode does not provide an atomic “queue only if still idle and unchanged”
operation, so a new user input can still race the final check and admission.

Run its focused tests with:

```sh
npm --prefix opencode/plugins/agent-loop-model-gate test
```
