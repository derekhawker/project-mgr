# Ticket-scoped OpenCode plugin behavior: research note

**Date:** 2026-11-09. **Source pin:** OpenCode `v2.1.4`, commit
`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824` ([tag][tag]). This is source/API
research, not a live integration test. The app's observed CLI pin is recorded in
[the workflow appendix](opencode-workflow-integration-research.md#evidence-and-version-boundaries).

## Answer

**A plugin cannot be enabled per session through the app's `workspace-ticket`
instruction entry.** Plugin activation is tied to OpenCode's configuration and
Location runtime, not an individual session or instruction key. But a plugin
that is loaded for a Location can keep its ticket-specific behavior inactive
unless the actual session is known to be ticket-associated. Thus distinguish
“module/setup loaded for a Location” from “ticket behavior applies to this
session.” The latter can be session-gated with the public prompt/context hooks;
it does not require separate per-session plugin loading. **Whether the proposed
plugin works in a live v2.1.4 runtime remains unvalidated.**

Evidence labels: **Documented** means official V2 documentation; **Pinned source**
means first-party `v2.1.4` implementation/API; **Inference/proposal** means a
design conclusion, not a tested guarantee.

## Scope and lifecycle

- **Documented:** Server plugins execute in the OpenCode server. Plugins in
  `.opencode/plugins/` load automatically; other packages/directories are
  configured under `plugins` in `opencode.json(c)`. Global config can distribute
  plugin config, while project/local configuration is discovered for a
  Location. The server guide says `setup` runs when the plugin loads and
  `ctx.location` describes the plugin instance's Location, explicitly *not* all
  sessions/events it can access. These are configuration/Location scopes, not
  session selectors. [Plugin overview][plugins] · [Server guide: lifecycle and
  context][server]
- **Pinned source:** OpenCode constructs plugins as part of the Location
  configuration/runtime graph; session execution chooses that Location's
  services. Moving a session changes its recorded Location and selects
  destination configuration/plugins for subsequent work; it does not rewrite
  all already-loaded plugin closures or make `ctx.location` become the target
  session's live location. See the existing [move and Location analysis][workflow]
  and its pinned source refs (`instance.ts`, `move.ts`, `runner/llm.ts`).
- **Inference:** Adding a plugin config only to a ticket worktree/project may
  limit loading to sessions whose Location resolves that config, but it is not
  a reliable ticket identity mechanism: ordinary/Quick Request sessions in the
  same Location can also activate it, and a moved session may activate a
  destination plugin instance. Do not equate a worktree path with ticket
  ownership.

## Session binding surfaces

- **Documented:** `ctx.session.hook("prompt", …)` runs after the session's
  Location plugins are ready and before attachment/skill resolution and durable
  prompt admission. It runs for commands that submit via `session.prompt`, once
  per admission (not every model turn); it exposes readonly `sessionID` and has
  no typed reject API. `context` hooks run immediately before model dispatch,
  including tool continuations, and carry `sessionID`. The public event stream
  also provides session events. [Server guide: session hooks and events][server]
- **Pinned source:** `SessionDomain` exposes public `hook` registration for
  `prompt`, `context`, `compaction`, `generate`, `title`, and related operations;
  hook payload types include `sessionID`. It does not expose a
  `session.created` admission callback in that domain. [Effect session API][session-api]
- **Inference/proposal:** If the app can mark the ticket session before its
  first prompt, a shared/plugin runtime binding keyed by the actual OpenCode
  `sessionID` can gate behavior. The app already performs ticket setup before
  attaching/resuming via `TicketWorkAdapter::prepare`, setting a session entry
  before `attach` ([app source][app-ticket]). A plugin can consult an app-owned
  registry/RPC or another deliberately shared binding. For context-sensitive
  behavior, check the binding on every relevant hook; do not cache a session's
  ticket status solely from the plugin instance's Location.

### Session-created event versus prompt/context hooks

**Pinned source:** session creation publishes a `session.created` event, but it
is an event notification after creation, not an awaited hook that blocks the
first prompt. The exact creation and event paths are in [`session.ts`][create]
and the [session event schema][events]. **Inference:** an asynchronous event
consumer may bind a session too late if a client submits its first prompt
immediately. The prompt hook is the useful first-admission boundary: it has the
real session ID and runs after Location plugins are ready. Context hooks are a
later, recurring guard if the ticket-specific behavior is model context/tools.
The prompt hook itself is not exactly-once and is not a general rejection gate;
keep binding writes idempotent and avoid irreversible side effects there.

## What `workspace-ticket` does (and does not do)

- **Pinned source:** keyed instruction entries are session-owned API data; the
  session instruction service renders each as an `api/<key>` instruction source.
  The experimental instruction-entry routes list/put/remove entries. No plugin
  discovery, config mutation, plugin activation, or lifecycle operation is part
  of that route or service. [Entry service][entry] · [session routes][routes]
- **Observed app code:** `workspace_ticket_work` calls `allow_ticket_directory`
  and `set_instruction_entry(id, "workspace-ticket", instructions)` in
  `TicketWorkAdapter::prepare`; it does not enable a plugin. [App ticket adapter][app-ticket]
- **Therefore (pinned source/inference):** an entry can communicate ticket
  instructions/metadata to the model, but cannot load or enable a plugin. A
  plugin could inspect `metadata.experimental.instructions` on a context hook,
  but using presence of `workspace-ticket` as its sole authorization signal is
  a proposal, not a first-party plugin-scoping contract; it is mutable prompt
  context, and absent entries do not prove the session is a Quick Request.

## Quick Requests, moves, and recommended shape

**Proposal:** load the observer wherever needed, but make its ticket behavior
opt-in. Have the app establish a session-ID binding as part of ticket preparation
before the first prompt; gate only ticket-specific work on that binding. For
other sessions—including Quick Requests/unbound sessions—the plugin may be
loaded and its generic hooks may run, but ticket behavior should be a no-op.
The existing per-session instruction entry can remain model guidance, not a
plugin switch. Runtime binding may be sufficient; this does **not** assume the
creator-session ID must be persisted in ticket frontmatter.

On a session move, re-read the actual session Location and apply explicit
policy: preserve ticket association across the move if desired, or disable it
when moving out of the ticket's allowed context. A moved session can receive
destination Location plugins on subsequent work; event/hook `sessionID` is the
target identity, whereas `ctx.location` only identifies the plugin instance.
Quick Requests that happen to share a project or worktree still need to remain
unbound. If association must be enforced against hostile plugins/processes,
hooks and instruction text are not a security boundary.

**Limitations / unvalidated:** v2.1.4 has no documented session-level plugin
enable/disable API or awaited plugin-load gate attached to an instruction entry;
public session hooks and events allow session-aware behavior only after a
Location plugin is loaded. First-party docs are V2 and may evolve beyond the
installed v2.1.4 CLI. This note did not launch OpenCode, load an observer plugin,
or validate app/plugin RPC or move behavior live.

## Sources

- **Official V2 docs:** [Plugin overview][plugins], [server plugin guide][server]
  (plugin load scope/context, hooks/events, session instruction-entry API).
- **Pinned first-party source:** OpenCode [`v2.1.4` tag][tag];
  [session creation][create] (`packages/core/src/session.ts`),
  [session event schema][events] (`packages/schema/src/session-event.ts`),
  [public Effect session API][session-api]
  (`packages/plugin/src/effect/session.ts`),
  [instruction-entry service][entry]
  (`packages/core/src/session/instruction-entry.ts`),
  [session protocol routes][routes]
  (`packages/protocol/src/groups/session.ts`). For Location/move behavior see
  the line-pinned sources in the [workflow appendix][workflow].
- **Repository:** [`TicketWorkAdapter`][app-ticket]
  (`app/src-tauri/src/lib.rs`, lines 329–374).

[plugins]: https://opencode.ai/v2/docs/build/plugins
[server]: https://opencode.ai/v2/docs/build/plugins/server
[tag]: https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.1.4
[create]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session.ts#L275-L325
[events]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/session-event.ts#L39-L90
[session-api]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/effect/session.ts#L139-L174
[entry]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/instruction-entry.ts#L69-L131
[routes]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/session.ts#L586-L644
[workflow]: opencode-workflow-integration-research.md#3-session-moves-change-location-context
[app-ticket]: ../app/src-tauri/src/lib.rs#L329-L374
