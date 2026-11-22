# Ticket agent-loop model-gate experiment

This separate plugin tests automatic continuation for explicitly allowlisted,
ticket-bound sessions. It
listens for session idle, binding, and lifecycle events; verifies the exact
Workspace-ticket session binding and deterministic safety gates; then asks the
session model for a strict JSON decision: `continue`, `complete`, `blocked`, or
`ask_user`. The classifier receives the latest assistant response and current
ticket/TODO contents. A `continue` must name an exact unchecked TODO item;
otherwise it fails closed. Only `continue` queues a prompt. Invalid or
unavailable evidence fails closed, and ticket/TODO content plus the idle
boundary are revalidated after generation.

The plugin registers `/agent-loop-model-gate-stop` and
`/agent-loop-model-gate-status`. Status reports only the last check time, outcome,
and a sanitized reason; it never stores the model's explanation, task text, or
session transcript. A stop is saved in plugin storage and prevents future
automatic prompts for that session. Use a fresh disposable session for another
experiment; this prototype does not yet define a resume action.

The plugin fails closed unless configured with a non-empty `allowedSessionIDs`
option. Session events, startup checks, stop commands, and ticket verification
are all limited to those exact IDs. The allowlist bypasses only the usual
current-directory equality check; the session must still belong to the current
OpenCode project, and its active ticket must name the same session ID.

## Isolated plugin configuration

`test-config/opencode.jsonc` adds this plugin and disables the existing
`project-mgr-agent-loop` by plugin ID. Replace its placeholder with a disposable
session ID before use. OpenCode passes `allowedSessionIDs` from the plugin
entry's `options` object. Do not omit the allowlist.

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
