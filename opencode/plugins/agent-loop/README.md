# Ticket agent loop for OpenCode V2

The loop is off by default. Start it from the target session in OpenCode's
terminal UI. The OpenCode server validates the ticket, holds the in-memory
authorization lease, and schedules continuation prompts. Closing, crashing,
or reattaching the TUI does not affect the runner. Loading `@agent-loop`
teaches the workflow but does not arm it.

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
   interrupt control separately if desired. A terminal pause (a stop, safety
   veto, blocker, limit, or unresolvable history) survives reload. Inspect the
   session, inbox, and stop reason before explicitly arming a new run.

The loop always allows up to 400 submitted prompts, including the first; this
limit is not configurable. The scheduling window is at most three hours; expiry
does not interrupt running work. Each server location can hold one loop and one
lease.
On first arm, an already-running session or delayed idle boundary gets up to five
minutes to settle; no prompt is submitted while it remains active. After that,
the loop pauses and requires a fresh opt-in.

## Automatic recovery

OpenCode V2 plugin storage saves armed intent and an admission record before
each prompt call. When OpenCode next loads the plugin at the same location, it
automatically reacquires authorization, checks the exact session and current
ticket/TODO, and reconciles durable inbox and history. It adopts an already
admitted prompt by ID even if the admission reply was lost. If neither inbox nor
history can confirm admission, it keeps watching and retries the **same**
reserved ID after a short delay, once fresh checks confirm an unchanged
boundary, no gates, and no durable cancellation. OpenCode's
[prompt-admission contract](https://opencode.ai/v2/docs/build/plugins/server#prompt-admission)
deduplicates pending or delivered IDs. Missing or unavailable reads are not
permission to retry; the loop keeps reconciling within the original deadline.
The journal stores the [durable session log](https://opencode.ai/v2/docs/api#tag-session)
watermark captured when arming and at each turn boundary. Recovery replays later events, so a
foreign input still vetoes the loop even if it was cancelled while unloaded.
An older in-flight record without a watermark pauses as
`recovery-log-boundary-missing`; it cannot safely reconstruct that gap.
Retries also require the same TODO fingerprint as the reserved turn, including
dependency and blocker notes but excluding the `Explore later` section.
Retries do not spend another turn. Recovery uses the original deadline, turn
count, and progress fingerprints; downtime counts against the deadline.
The journal stores paths, IDs, and run metadata, not prompt contents,
checklist contents, credentials, or lease tokens. It cannot recover runs armed
before durable records existed.

The V2 API documents prompt admission and ID deduplication, but does not
promise that server startup drains every pending queue or that a deduplicated
reply wakes a parked turn. If the reserved item stays pending without a running
session, recovery safely retries that ID and reports `pending-prompt-not-running`
if it remains parked. It never inserts a second item or steers the session to
force progress, and stops at the original deadline. This behavior is covered
by fake-server tests; startup draining was not verified on a live server.

The [V2 interruption schema](https://opencode.ai/v2/openapi.json) distinguishes
`shutdown` from `user`, `superseded`, and `inactivity`. On `shutdown`, the loop
watches the original turn instead of sending another prompt. It waits for
OpenCode to resume it and for the exact turn's durable history to prove success.
It keeps the prior turn and log watermark if shutdown appears during
continuation checks. If shutdown blocks an ID reserved but not yet submitted,
the journal retains that ID and the prior completion boundary. After durable
resume evidence and a fresh idle check, recovery can submit that reservation
without charging another turn. A crash during the admission write may leave
the record marked as possibly submitted; it is not treated as unsent.

If an interrupted idle marker appears first, the loop briefly waits for the
durable cause within the original deadline. If the cause cannot be confirmed,
it does not advance. User interruption and other safety vetoes still stop the
loop immediately when observed.

Recovery starts on plugin load, not on a TUI command. It cannot run while the
server is down or while OpenCode has not loaded the location again. The V2
[server plugin lifecycle](https://opencode.ai/v2/docs/build/plugins/server#lifecycle)
and [Effect plugin scope](https://opencode.ai/v2/docs/build/plugins/effect#lifecycle)
do not expose a location keepalive or arbitrary registered background job. The
documented background-session action is for blocking tools, not plugin code.
The [location idle timeout](https://opencode.ai/v2/docs/config#location-idle-timeout)
defaults to 60 minutes. Disabling it for a project could avoid idle unloads,
but would not wake a stopped server or restore a location after restart. The
plugin depends on OpenCode to load the location and resume the session. It
does not install a supervisor, start OpenCode, or change configuration.

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
  user-data cutover, and closeout are excluded by the prompt and skill, not
  enforced by a tool sandbox.
- Two turns without a changed, previously unseen approved-TODO queue stop the
  loop. This is a continuation heuristic, not proof of implementation progress;
  a TODO edit or agent report is not independent verification.
- V2 does not offer an atomic “only queue if idle and unchanged” operation.
  Another input, move, stop, or interruption can race final checks and
  admission. If a permission/form request is opened and resolved between polls
  or during unload and its live event is lost, the plugin may not observe it.
  Stop and resume explicitly when work reaches a decision or permission gate.
- Recovery coordinates overlapping plugin instances in one OpenCode server.
  V2 plugin storage does not provide atomic claims across separate server
  processes. Do not run concurrent servers against the same plugin database.
  Storage failure blocks admission. A stop reason marked `-not-saved` has not
  been confirmed durable. An explicit stop takes effect across plugin instances
  in the same process, even while the journal is unavailable. If the process
  itself exits before the stop is saved, the next process can only see the last
  committed record; do not treat `-not-saved` as a committed stop.
  `recovery-storage-write-pending` means the caller stopped waiting but the
  write has not settled. Cleanup can return, but the old instance keeps its
  fence until the serialized writes settle. Storage has no cancellation or
  compare-and-swap: forcibly releasing that fence could let a late write
  overwrite a newer run. If the write never settles, the replacement cannot
  safely take over in that process.
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
