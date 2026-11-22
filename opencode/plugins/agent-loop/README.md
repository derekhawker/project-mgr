# Ticket agent loop for OpenCode V2

The loop is off by default. Start it from the target session in OpenCode's
terminal UI. The OpenCode server validates the ticket, holds the in-memory
authorization lease, and schedules continuation prompts. Closing, crashing,
or reattaching the TUI does not affect the runner while the server plugin
stays loaded. Loading `@agent-loop` teaches the workflow but does not arm it.

## Install globally

From the repository root, after review:

```sh
repo="$PWD"
config="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
mkdir -p "$config/local-plugins" "$config/skills"
ln -s "$repo/opencode/plugins/agent-loop" "$config/local-plugins/agent-loop"
ln -s "$repo/opencode/skills/agent-loop" "$config/skills/agent-loop"
```

Add `"./local-plugins/agent-loop"` to `plugins` in that directory's
`opencode.jsonc`. [OpenCode V2 resolves local plugin directories relative to
that config file](https://opencode.ai/v2/docs/plugins#configure). If needed, use
`/reload`. No npm install is needed. To uninstall, remove the config entry and
both links.

## Start, check, or pause

1. Open the ticket's own session at its worktree. Wait for it to finish any
   current turn, and choose the model and appropriate permissions.
2. Run `/agent-loop-start`. It reads the ticket path from the target session's
   `workspace-ticket` instruction entry and derives its `<slug>.todo`
   companion. No paths or prompt budget are requested. Select **Arm loop** only
   after checking the preview of the session, location, both paths, and fixed
   limit. The ticket must be `in_progress`, record that exact `work_session_id`,
   and reference its readable TODO companion. The server supplies the
   paths for the preview and rechecks the binding and files before each prompt.
   A missing, unreadable, malformed, or changed binding blocks admission. Open
   or resume the ticket through project-mgr's **Work** action, or continue
   manually after checking the canonical records.
3. `/agent-loop-status` queries the server for the state, reason, and prompt
   count. `/agent-loop-stop` prevents further scheduling and revokes the lease
   for the current session. It does not cancel an admitted turn; use OpenCode's
   interrupt control separately if desired. Re-arm only after inspecting the
   session, inbox, and stop reason.

The loop always allows up to 400 submitted prompts, including the first; this
limit is not configurable. The scheduling window is at most three hours; expiry
does not interrupt running work. Each server location can hold one loop and one
lease.
At startup, an already-running session or delayed idle boundary gets up to five
minutes to settle; no prompt is submitted while it remains active. After that,
the loop pauses and requires a fresh opt-in.
Server or server-plugin restarts clear the in-memory runner and lease and
require fresh opt-in. Losing authorization also requires fresh opt-in.

## Safety and reliability

- The server polls every two seconds while active, with bounded requests and no
  new polling after expiry or stop. Live
  events can veto scheduling; they never authorize another turn. To continue,
  the durable transcript must contain the exact admitted user prompt directly
  after the recorded prior boundary, its assistant work (including any
  compaction), and one successful closing idle record. OpenCode's exact fixed
  recovery notice for an interrupted response is allowed inside that turn;
  other synthetic or foreign input, missing or ambiguous history, and failures
  stop the loop. History is paged as needed to find the admitted prompt and its
  boundary, up to 1,000 records per reconciliation; turns beyond that bound
  require re-arming.
- Pending inbox work, permission requests, and session or location forms are
  checked before scheduling. The plugin never replies to any of them. Keep
  permissions restrictive and do not use `--auto`. Destructive actions,
  user-data cutover, closeout, and human-only acceptance are excluded by the
  prompt and skill, not enforced by a tool sandbox.
- Two turns without changed, previously unseen progress-record content stop the
  loop. This catches recorded evidence updates even when checklist boxes remain
  open. It is still a heuristic, not verified implementation progress; an
  agent's completion or blocker report is likewise not independent proof.
- V2 does not offer an atomic “only queue if idle and unchanged” operation.
  Another input, move, stop, or interruption can race final checks and
  admission. A response lost after admission is ambiguous and is never
  retried. If a permission/form request is opened and resolved between polls
  and its live event is lost, the plugin may not observe it. Use manual
  continuation for work that needs human review between every turn.
- The plugin does not log payloads. Ticket paths appear in the confirmation
  dialog and the usual OpenCode session history. Do not include secrets in paths.
- The binding checks agreement with the app-written session entry, not
  independent Workspace membership. In OpenCode v2.1.4, the server plugin
  context does not expose activity, inbox, forms, durable messages, or keyed
  instruction reads. The plugin uses the same server's public loopback API for
  those reads, authenticated by the managed service's private registration or
  the credentials of a local `serve` invocation with an explicit port. It
  fails closed if it cannot identify or read from that server. A transient
  standalone server with a dynamic port is not supported on this version.

Run the focused tests with `npm --prefix opencode/plugins/agent-loop test`.
