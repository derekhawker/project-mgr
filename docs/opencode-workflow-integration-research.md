# OpenCode workflow integration: technical research appendix

**Research date:** 2026-11-07. **Installed CLI observed:** `opencode v2.1.4`
at `~/.opencode/bin/opencode`. This appendix supports a future-direction
discussion; it does not change the accepted product contract or propose an
implementation sequence.

## Findings in brief

1. **A shell's working directory is not a session's Location.** A child can run
   shell commands in a worktree while its session, ambient instructions, skills,
   configuration, and default tools remain rooted in another checkout.
2. **New subagents inherit the parent's current recorded Location once.**
   Continuing an existing child does not inherit later parent moves. Parent and
   child locations can subsequently differ.
3. **Moving the session is a real context change, not a filesystem move.** It
   changes the recorded directory and project context at a safe boundary;
   destination services supply future tools and instruction observations. It
   preserves conversation and instruction state rather than starting clean.
4. **No child system message does not mean no initial AGENTS.md.** The initial
   instruction baseline emits an event with hashes, not a chronological system
   message. Historical event-payload retention defaults to off in the reviewed
   CLI/server path. A session-log watermark alone cannot establish that baseline;
   even a retained source hash does not identify every instruction file.
5. **Worktree removal does not establish session safety.** The reviewed removal
   path neither moves children nor checks their recorded locations. A retained
   child can point at a removed worktree.

Sources and qualifications for these conclusions follow below.

## Evidence and version boundaries

The evidence levels used here are deliberately separate:

| Label | Meaning |
|---|---|
| **Documented V2 contract** | Official V2 documentation fetched on the research date. It describes supported behavior, not an assurance of indefinite API stability. |
| **Experimental** | Explicitly experimental documentation or protocol surface. In particular, the API overview labels the HTTP surface experimental and the session group calls its routes experimental—even routes without `/experimental/` in their path. |
| **Pinned source** | First-party implementation at tag `v2.1.4`, resolving to commit `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`. This is source evidence, not a live execution test. |
| **Observed local** | Installed CLI version/help, or concrete session evidence supplied by the main investigation. |
| **Inference / unverified** | A consequence of the reviewed code, or an integration possibility not exercised here. |

Only V2 documentation was used: [V2 introduction][d-intro],
[API reference][d-api], and their V2 topic pages. The V2 machine-readable index
currently contains links without the `/v2` prefix; those links were not used as
V1 documentation. Current website text can advance beyond installed v2.1.4.
The [tag reference][s-tag] pins implementation claims below.

The existing [`opencode-v2-contract.md`](opencode-v2-contract.md) records
**v2.0.27**, not this installed version. Its app-owned server/TUI boundary remains
relevant, but its version-specific omissions are not evidence that v2.1.4 lacks
session moves, metadata, or worktree APIs. The accepted
[`workspace-refactor-target.md`](workspace-refactor-target.md) currently chooses
Rust-managed worktrees and explicit worker sessions rather than native
subagents. Those are product decisions, not OpenCode limitations.

Research was read-only except for this appendix. No prompt, session, worktree,
configuration, runtime, or user data was created or changed. No raw model
context, provider-native data, or reasoning was requested. Codesitter was
checked first for available local semantic navigation; the apparent local
`programs/opencode` directory was not the OpenCode source repository and had no
usable index. No index was created. Pinned remote source was inspected instead;
no project-mgr code index was needed. The installed executable is a bundled ELF,
not a readable source checkout; limited embedded-string checks are not treated
as a proof that the entire binary equals the tagged source.

## 1. Four different meanings of “working directory”

| Context | What determines it | What it does not establish |
|---|---|---|
| Session Location | `Session.Info.location.directory`; creation or explicit session move | The cwd of every individual subprocess |
| Tool/runtime context | Location-scoped services selected for session execution | The parent session's current directory after a child already exists |
| Shell invocation cwd | Explicit shell `workdir`, otherwise the active Location directory | A change to session Location, ambient AGENTS.md, or available skills |
| Terminal/client launch cwd | OS process launch and client location selection | An automatic relocation of an existing session identified by ID |

**Pinned source:** the shell tool passes `input.workdir` as the shell operation's
`cwd`; the shell service defaults it to `location.directory` and supplies it to
process spawn. Neither operation calls session move. The instruction discovery
plugin independently captures `location.directory` and
`location.project.directory` for its upward search. Thus changing only shell
`workdir` cannot refresh session-level instructions. [Shell tool][s-shell-tool]
(lines 198–217), [shell service][s-shell] (lines 267–317),
[instruction configuration][s-config-instruction] (lines 36–58).

**Documented V2 contract:** shell `workdir` selects a command's directory;
`tools.opencode.session_move` changes session location and takes effect at a
safe boundary. These are distinct operations. [Tools][d-tools].

**Constraint:** raw shell access still has the host user's authority. Directory
selection and prompts are not security isolation. OpenCode checks shell and
external-directory permissions; a workflow requiring enforced checkout safety
needs explicit permission/policy boundaries, not an instruction to “stay in the
worktree.” [Tools][d-tools], [agents/permissions][d-agents].

## 2. Child creation, reuse, and independent locations

**Documented/pinned contract:** `POST /api/session` accepts `parentID`, but a
child is created at its parent's location. In v2.1.4, the server handler ignores
the supplied `location` branch when `parentID` exists. Core's typed input makes
`location` and `parentID` alternatives, and creation uses
`parent?.location ?? input.location`. Supplying both is not an independent-child
directory override. [Session protocol][s-session-protocol] (lines 171–192),
[server handler][s-session-handler] (lines 93–108), [core session][s-session]
(lines 86–95, 275–305).

The built-in subagent tool has no working-directory parameter. It creates a
child with parent ID, agent, title, and model. On reuse by `sessionID`, it verifies
the child belongs to the calling parent, optionally switches agent/model, and
submits another prompt to that child. **It does not move the child to the
parent's current location.** [Subagent implementation][s-subagent] (lines
29–48, 153–213).

Children have fresh conversation context, not a copy of the parent's full
conversation. A child loads its own ambient instructions from its Location.
Metadata and session permission rules are inherited at creation unless
explicitly supplied; the subagent tool separately selects explicit model,
configured agent model, then parent model. These are snapshots/defaults, not
continuously synchronized family state. [Agents][d-agents], [core session][s-session]
(lines 298–302), [subagent implementation][s-subagent] (lines 168–213),
[metadata schema][s-metadata].

**Possible, not validated here:** create a linked child, explicitly move that
child to another existing directory, observe the completed move, then prompt
it. A native child relationship does not prevent later location divergence.
Alternatively, create independent root sessions at exact directories and keep
application-level associations. The latter fits the current accepted worker
model without depending on initial parent-location inheritance.

**Important source/documentation discrepancy:** the pinned fork implementation
copies projected history and seeds instruction state, but its test explicitly
expects `forked.parentID` to be undefined and `forked.fork.sessionID` to identify
the source. Do not conflate fork ancestry with subagent `parentID` hierarchy,
despite the protocol description calling a fork a “child session.”
[Core fork][s-session] (lines 326–365), [fork test][s-create-test] (lines 545–573).

## 3. What a session move refreshes—and what it preserves

**Documented V2 contract:** moves may target another session by ID or the current
session. Relative paths resolve from the target session's directory; `~` is
supported. Destination-dependent operations belong in a later tool call, not
the same `execute` block. [Tools][d-tools], [move tool][s-opencode-tool] (lines
22–29, 130–154).

**Pinned source:** `POST /api/session/{sessionID}/move` accepts destination
`directory` and optional `delivery` (`steer`/`queue`) and returns no content.
The move service validates that the destination exists and is a directory,
resolves its project, and checks destination Location initialization. Normal
moves are durable inbox controls. The runner closes that session's model
transport, publishes `session.moved`, and continues execution through the new
Location. [Session protocol][s-session-protocol] (move endpoint),
[move service][s-move] (lines 74–158), [runner][s-runner] (lines 73–113),
[execution][s-execution] (lines 102–105).

| Refreshes/selects for subsequent work | Preserves / does not automatically change |
|---|---|
| Recorded session directory, subpath, project identity, workspace identity | Session ID and conversation history |
| Destination Location's configuration, plugin/tool capabilities, skill catalog, ambient instruction sources | Agent/model selection, opaque session metadata, session-specific permission rules |
| Environment instruction describing directory and repository context | Existing child session locations or their instruction state |
| Instruction observations and chronological updates when sources differ | Files, branches, worktree layout; running external processes are not `chdir`ed |

The projector updates only the row whose ID is the moved session, not its
descendants. It does not clear instruction state. The Location graph contains
configuration, plugins, skills, tools, instruction discovery, and built-in
environment instructions. Before a model step, instruction state is compared
with the destination's selected sources. [Projector][s-projector] (lines
481–496), [Location graph][s-instance] (lines 60–114), [runner][s-runner] (lines
195–199), [environment instructions][s-builtins] (lines 34–52).

**Instruction update is not historical erasure.** The previous baseline can
remain in the assembled prefix while later chronological messages say which
instructions no longer apply and introduce the destination's guidance. Source
rendering explicitly distinguishes removed, added, and changed paths. This
explains why the audited parent contains both location-switch and instruction
update records. [Instructions documentation][d-instructions],
[instruction state][s-instruction-state] (lines 38–60, 172–181),
[discovery rendering][s-discovery] (lines 123–148).

**Do not treat successful admission as a completed move.** The tool returns its
requested directory after submitting the move; the active runner applies it at
a later safe boundary. Read back the session or observe `session.moved` before
assuming a new context. Destination validation and later execution are also
different boundaries. There is an explicit recovery path for an idle session
whose old directory is gone/unusable: core can publish the move without loading
the broken source. This recovery capability is not automatic child repair.
[Move tool][s-opencode-tool] (lines 137–147), [move service][s-move] (lines
104–158).

**Not established here:** attached TUI native tab/layout behavior after a move,
every plugin's captured-state behavior, or an atomic “move family” operation.
A plugin's `ctx.location` is its own instance location, not every session/event
it can access. Cross-location orchestration must inspect actual target session
records rather than reuse that value as universal cwd. [Plugin server][d-server].

## 4. AGENTS.md, initial baselines, and safe evidence

### Loading rules

**Documented V2 contract:** global `~/.config/opencode/AGENTS.md` loads first,
then upward-discovered AGENTS.md nearest-first. For a Location under the user's
home, the ancestor walk reaches home; otherwise it stops at the project root.
If the Location lies outside its project root, only global discovery applies.
V2 recognizes `AGENTS.md`, not `CLAUDE.md` as a fallback. Configured `instructions`
add further local/glob/URL sources. Do not confuse these instruction-discovery
boundaries with configuration files, whose upward discovery reaches filesystem
root. [Instructions][d-instructions], [config][d-config],
[instruction plugin][s-config-instruction] (lines 36–58, 84–109).

Nested AGENTS.md files load as reads/listings explore directories beneath the
Location. They are separate synthetic history entries with path metadata and
deduplicate against model-visible history. They can be reintroduced after
compaction/revert drops that history. Loaded nested file edits are not
automatically refreshed; global/upward ambient guidance is watched and updated.
[Instructions][d-instructions], [nested instruction loader][s-nested]
(lines 35–43, 57–79, 99–110).

### Why missing system messages and empty entries prove little

The first ambient instruction observation emits a
`session.instructions.updated` event, classified as durable, with:

- `metadata.instructions.initial: true`;
- `data.delta`: instruction-source keys mapped to hashes;
- no chronological update text for that initial observation.

Here “durable” describes the event/projection contract, not unconditional
retention of its replay payload. The reviewed bus defaults historical payload
retention to `false`; projections and sequence watermarks still advance. The
live envelope's `metadata.instructions.initial` is also not stored by the
reviewed event-table write/read path. Do not require that metadata field in a
historically replayed event. [Bus][s-bus] (lines 179–208, 401–436, 770–809),
[event tables][s-event-tables] (lines 4–25).

The projector creates a system message **only if the event has update text**.
Initial baseline rendering is assembled separately for model requests. Therefore
ordinary message history need not contain a system message for initial global
or repository AGENTS.md. [Instruction state][s-instruction-state] (lines 21–60,
172–181), [message updater][s-message-updater] (lines 151–163),
[history assembly][s-history] (lines 197–205).

`GET /api/experimental/session/{id}/instructions/entries` lists **API-managed
keyed entries**, not all AGENTS.md sources or the assembled model instructions.
Those entries use `api/<key>` sources. An empty result is consistent with normal
ambient instruction loading. [Session protocol][s-session-protocol]
(instruction-entry routes), [entry service][s-entry] (lines 69–78, 111–131).

### Read-only log check: supported request and observed limitation

Use the existing authenticated server and
`GET /api/experimental/session/{id}/log?follow=false`. Do not create a private
server, new session, or model turn. The log supports an exclusive `after`
sequence cursor, not page `limit`. Replay requires retained event payloads.
Filter the response **before displaying or
persisting it** to retain only:

```text
event ID, created timestamp, durable sequence/version,
type == session.instructions.updated,
metadata.instructions.initial, when present (not retained by historical replay),
keys and hashes in data.delta (omit data.text)
```

A streaming client can stop after the first matching baseline, avoiding the
CLI's audited 262144-byte output cap and unrelated prompt/tool/provider events.
Keep the same configured server/authentication context; default CLI service
discovery may otherwise start a server. Message pages of 5–10 remain useful for
the separate message audit but are not pagination for the event log.
[Session protocol][s-session-protocol] (log endpoint), [session log][s-session]
(lines 435–445), [server handler][s-session-handler] (lines 582–588),
[client/service documentation][d-client].

**New live read-only evidence supplied by the main investigator:** both children
were queried with `log?follow=false` and `log?follow=false&after=0` through
`opencode api get`. Every response contained only `log.synced`: shaping had
`seq: 44`, testing had `seq: 579`. The responses were only 85/86 bytes, with zero
instruction events; the earlier CLI output-size cap does not explain these
results. This appendix did not duplicate those requests.

**Pinned contract interpretation:** `after` is a plain nonnegative integer
parsed from a query string, not an opaque cursor. Omitting it initializes the
internal cursor to `-1`, meaning all retained sequence rows; `after=0` excludes
only sequence 0, not all replay. `follow=false` still replays before the synced
marker. There is no separate replay-enabling query parameter. The marker reads
the independent sequence table, so it can report a high watermark with no
retained payloads. [Log protocol][s-session-protocol] (lines 664–681),
[bus replay][s-bus] (lines 22–32, 770–809, 834–875).

**Likely source-supported explanation, not a configuration audit:** the bus
uses `persist = options?.persist ?? false`; server routes pass
`options.events?.persist`, and the pinned standard CLI server launch supplies
no `events` override. This naturally permits projected messages/instruction
state and sequence watermarks without historical log rows. It fits the live
responses but does not prove the running binary's exact options or the
historical retention state. Enabling retention would change runtime behavior
and would not reconstruct old payloads; no such change is proposed or made.
[Bus][s-bus] (lines 207–208, 401–436), [server graph][s-server-routes] (lines
116–120), [CLI launch][s-cli-server] (lines 100–144).

The precise raw CLI request shape, if clarification is needed, is:

```sh
opencode api get "/api/experimental/session/<child-session-ID>/log?follow=false"
```

Use the existing configured server/authentication context. **No repeat is needed
if this is how the supplied requests were made.** The raw method/path form
preserves URL query parameters but ignores separate `--param` values; those
values are interpolated only for the operation-ID form. Thus
`opencode api get /path --param follow=false` is not equivalent. If a future
diagnostic needs the cursor, append `&after=<observed-sequence>` inside the
quoted URL. The CLI buffers `response.text()` before printing, so `follow=true`
is not a useful bounded read through this CLI handler. [CLI API handler][s-cli-api]
(lines 27–45, 54–89).

**Conclusion for these children:** the attempted read-only log check did not
establish their initial instruction baseline. Neither synced-only response is
evidence that AGENTS.md was absent or unused. No supported alternative replay
parameter was found that would recover payloads not retained.

**What a retained event could prove:** a `core/instructions` source observation
was admitted for that session at its recorded sequence, if that delta is
present. Identifying it as the original baseline additionally needs sufficient
initialization/ordering evidence; historical replay does not preserve the live
initial marker. **What it does not prove alone:** which AGENTS.md paths/content formed the grouped source, that
the model obeyed them, or that every intended file was readable. The
`core/instructions` source groups discovered/configured files; its event carries
a hash rather than a per-file inventory. [Discovery][s-discovery] (lines 10–17,
80–95), [instruction event schema][s-events] (lines 266–281).

A stronger content-free cross-check is possible only if the exact historical
source array can be reconstructed: preserve file order and historical absolute
paths/content, canonicalize JSON object keys, and compare SHA-256 to the event
hash. The grouped array contains `{path, content}` entries. Current files or
repository commit contents alone may miss historical global instructions,
configured URLs/files, or uncommitted edits. Do not claim a match without doing
that comparison. Privileged internal instruction blobs are implementation data,
not a documented public provenance endpoint; this investigation did not open
the live database or retrieve those blobs. [Hash implementation][s-instructions]
(lines 194–195, 243–250), [discovery file shape][s-discovery] (lines 8–17).

## 5. Interpretation of the supplied session evidence

The main investigator supplied these audited facts; this appendix does not
repeat its transcript inspection:

- Root `ses_e4bae403effeE89cEIZx2ded4L` moved into the
  `stepped-terrain-rendering` worktree and later moved back. A location-switch
  message and a following system update explicitly replaced source-checkout
  guidance with worktree guidance.
- The shaping child stayed at the source checkout. The testing child
  `ses_e4b8d2d86ffevHEgfNRPGFMh5Z` was created after the root's move, inherited
  that worktree location, and remained there after its removal. Fourteen testing
  handoffs reused that same child.
- Child message history showed no system messages; API-managed instruction
  entries were empty.

**Technical interpretation:** this is consistent with creation-time location
inheritance, retained locations on reuse, and non-chronological initial
instruction baselines. It is stronger runtime evidence of child-location
inheritance than a shell command's cwd, but **not yet direct runtime proof of
the child's exact initial AGENTS.md content**. The subsequent synced-only
event-log checks did not narrow that uncertainty. [Core creation][s-session] (lines 275–305),
[subagent reuse][s-subagent] (lines 153–213), [initial projection][s-message-updater]
(lines 151–163).

**Stale-directory risk:** moving the parent back does not repair existing
children. Removing the worktree can leave a reusable child whose default tools,
instruction environment, and session location refer to a nonexistent path.
Explicit shell `workdir` overrides can obscure this mismatch rather than fix
it. An application must not equate “parent moved away” or “child inactive” with
“no retained session points here.” This is an inference supported by the
single-session move projector, unchanged-child reuse path, removal path below,
and the supplied audit—not a claim that OpenCode automatically recovers it.

## 6. Worktree inventory, creation, removal, and events

**Documented/pinned contract:** worktree APIs are project-based, not directory-
or session-based. The convenience model tool infers the project from its loaded
Location; the HTTP/client API requires `projectID`.

| Operation | Contract / constraint |
|---|---|
| `GET /api/worktree?projectID=…` | Saved inventory only; returns an array of `{directory, strategy?}`, not the usual session `data` wrapper. Does not refresh discovery or load plugins. |
| `POST /api/worktree` | `projectID`, optional `name`, parent `directory`, source `from`, starting `branch`; returns `{directory}`. Loads the canonical checkout's strategy/configuration. |
| `POST /api/worktree/refresh` | Loads canonical plugins, discovers across known checkout roots using available strategies, reconciles inventory. It is a mutation, not a read-only list. |
| `DELETE /api/worktree` | `projectID`, exact directory, required `force`; uses recorded strategy ownership, not whichever strategy is now default. |

Sources: [worktree protocol][s-worktree-protocol], [worktree schema][s-worktree-schema]
(lines 11–52), [plugin worktree documentation][d-server],
[convenience tools][s-opencode-tool] (lines 155–205).

Default destinations use server data under
`worktree/<first-six-project-ID-characters>`; `worktree.directory` changes the
parent, and relative configuration resolves from the saved canonical checkout.
An alternate source must belong to the project but does not change the
configuration root. New strategy registrations select the default; existing
inventory retains strategy ownership. These are useful extension points, not
automatic application ownership of branches or cleanup. [Config/worktrees][d-config],
[plugin worktrees][d-server].

Creation records the actual returned directory, emits an inventory update, and
then runs a configured project startup command in the new directory. A setup
command failure can therefore occur **after** the worktree/inventory exists;
an API error must not be interpreted as “nothing happened.” Creation is not
documented as an idempotent request keyed by an application operation ID.
[Worktree core][s-worktree] (lines 204–255).

Removal validates saved strategy ownership and delegates to that strategy, then
removes the inventory row. The reviewed path does not query sessions or move
children. Git's strategy delegates to Git worktree removal; `force` permits
discarding changes and needs explicit user authorization. [Worktree core][s-worktree]
(lines 257–271), [Git strategy][s-worktree-git] (lines 22–26), [tools][d-tools].

**Events:** `worktree.updated` is an ephemeral project-ID invalidation; consumers
list inventory again. `worktree.resolved` is a durable project identity
resolution event, not “a task finished” or “worktree provisioned successfully.”
The source also defines `worktree.ready`/`worktree.failed`, but they are not in
the reviewed public server manifest; their mere source existence is not a
public subscription contract. [Worktree schema][s-worktree-schema] (lines
55–71), [server manifest][s-event-manifest] (lines 53–80, 85–99),
[additional worktree events][s-worktree-events].

## 7. Hierarchy, annotations, and reliable observation

**Documented/pinned capabilities:** session records expose ID, `parentID`,
separate fork ancestry, Location, agent/model, metadata, outcome and timestamps.
Listing supports direct parent, directory, project/subpath, ordering, search,
and cursors. Enumerating a hierarchy requires following direct-child pages;
the API is not a product dependency graph. [Session schema][s-session-schema]
(lines 31–60, 69–106), [session protocol][s-session-protocol].

Metadata is opaque JSON keyed by the host and inherited by children at
creation unless supplied. Updating metadata replaces the supplied metadata
value; it is not a promised recursive merge or automatic propagation to existing
children. It can carry association IDs, roles, schema versions, or origin tags,
but does not make OpenCode authoritative for project-mgr lifecycle or path
ownership. Keep secrets, regular prompt contents, and duplicated conversations
out of such annotations. [Metadata][s-metadata], [creation][s-session]
(lines 298–302), [metadata update][s-session-operations] (lines 85–91),
[`workspace-refactor-target.md`](workspace-refactor-target.md).

`session.created`, `session.moved`, `session.metadata.updated`, execution events,
inbox events, and instruction events provide meaningful observation points.
`GET /api/event` is live-only across all server locations; disconnects and slow
consumers can lose/fail the stream. The experimental per-session log provides
replay of retained event payloads after an exclusive sequence and optional live
follow; default CLI startup does not enable historical payload retention in the
reviewed source. Its existence is not proof of usable replay for a particular
session. On
reconnect, reconcile actual records, active execution, inbox, and pending
permissions/forms—not only remembered events. Absence from `/api/session/active`
means inactive, not necessarily successful or ready for application completion.
[Events protocol][s-event-protocol], [session protocol][s-session-protocol],
[event schemas][s-events], [client streams][d-client], [bus retention][s-bus],
[CLI launch][s-cli-server].

Deletion is particularly significant: removing a session recursively removes
its children. It is not a harmless way to hide a product work item. Archive,
application visibility, conversation retention, and resource cleanup should
remain distinct concepts. [Plugin sessions][d-server], [core removal][s-session]
(lines 374–383).

## 8. Reusing skills without recreating their workflows

**Documented V2 contract:** reusable skills already have global sources
(`~/.config/opencode/skills`, compatibility `~/.agents/skills` and
`~/.claude/skills`), project sources, explicit extra local directories, and HTTP
catalogs. A global skill can apply to an orchestrator and repo-local workers
without copying its body into app-generated files. Project `.opencode/skills`
and configured sources can override IDs according to documented precedence.
Discovery is Location-dependent, so a shell cwd override does not select a
different skill catalog. [Skills][d-skills], [session context selection][s-context]
(lines 149–163).

Skills are task guidance, **not executable tool registration or an enforcement
mechanism**. The catalog advertises ID/name/description and loads the selected
body when invoked, subject to permissions. Explicit skill attachment/activation
is possible, but the dedicated activation endpoint is experimental and can
resume a session; it is not a read-only readiness check. Existing repository
skills can remain responsible for review/commit/merge practices rather than
having project-mgr replace them with its own universal workflow.
[Skills][d-skills], [tools/extensions][d-tools],
[activation protocol][s-session-protocol], [accepted product contract](workspace-refactor-target.md).

## 9. Plugins, custom RPC, and orchestration choices

For exact native-tool interception, Code Mode operation identity, and child
first-turn admission limits, see the later
[focused tool-observation research](opencode-tool-observation-research.md).
That appendix narrows the generic plugin possibilities here to public hooks
and pinned execution paths; it does not claim live plugin acceptance.

**Documented V2 contract:** server plugins can register tools, commands, skill
transforms, session hooks, worktree strategies, storage, and typed RPC. Their
context exposes client-like operations such as session creation, move, prompt,
read/update, interrupt, and wait. Local `.opencode/plugins` load automatically;
global/package configuration also supports reuse. TUI and GUI plugin parts are
separate; an OpenCode Desktop GUI plugin is not a Tauri WebView extension.
[Plugin overview][d-plugins], [server plugin API][d-server].

Custom RPC contracts define methods, errors, and events. External clients can
call `POST /api/rpc/{rpcID}/{method}` with `{input: …}` and receive
`{output: …}`; typed clients share a contract. Location selection is separate
from RPC input, and RPC events include their location. Subscriptions are
live-only and lose disconnected events. A registered contract alone does not
load/activate its server implementation. [RPC][d-rpc], [client RPC][d-client].

These support several plausible seams, **not an implementation plan**:

| Choice | Fit | Constraint |
|---|---|---|
| Rust app coordinates existing exact worker IDs over the HTTP API | Keeps lifecycle, validation, process ownership and durable associations in project-mgr; OpenCode owns conversations | Version-pin/check the experimental wire contract and reconcile moves/events |
| Thin plugin exposes repository/workspace-aware model tools, with typed RPC for app coordination | Avoids asking a model to manipulate app records or guess session IDs; can reuse global skills | Authenticate/validate mutating operations in Rust; filter plugin events by actual location/session; do not make plugin storage a second lifecycle database |
| Native subagents form an OpenCode conversation family | Built-in foreground/background handoff, child reuse and completion notification | No create-time cwd override; reused children can remain at stale locations; hierarchy is not an app work graph |
| OpenCode manages worktree provisioning through its API/strategy | Reuses inventory and canonical strategy selection | Reopens the currently accepted Rust provisioning/ownership boundary; startup side effects and child-safe cleanup still need an owner |
| Embedded SDK hosts OpenCode in a JS application | Explicitly owned host with no HTTP listener | Not a drop-in Rust/Tauri integration; adopting it would change the current runtime boundary, not simply replace one HTTP call |

The SDK hosts the server/router in process, while the network client connects
to an existing server. Neither requires adopting the independently managed
background service: discovery/ensure/start behavior is an explicit service
layer. Preserving the app-owned server remains a viable choice.
[SDK][d-sdk], [client/service][d-client],
[`opencode-v2-contract.md`](opencode-v2-contract.md).

## Remaining uncertainties

- The supplied audit proves specific locations and parent instruction updates.
  Both children's subsequent log checks returned only synced watermarks, so
  their exact historical initial file sets remain unproven. No read-only public
  request was established that recovers an unretained baseline.
- Source review establishes behavior at the pinned tag, not exhaustive binary
  equivalence or a live multi-client/plugin acceptance test.
- A move is not a promise to rewrite every plugin closure, process cwd, nested
  instruction synthetic, existing child, or application association.
- Current V2 documentation and the installed OpenAPI must be checked together
  before relying on newer plugin hooks/strategies or generated client shapes.
- Native TUI/Wayland appearance, terminal restoration after external moves,
  provider-dependent execution, and cleanup recovery were not exercised.

## Primary sources

Documentation URLs were fetched with the V2 prefix. Source links pin v2.1.4;
line numbers in the text refer to those files, not project-mgr files.

[d-intro]: https://opencode.ai/v2/docs/
[d-api]: https://opencode.ai/v2/docs/api
[d-tools]: https://opencode.ai/v2/docs/tools
[d-instructions]: https://opencode.ai/v2/docs/instructions
[d-config]: https://opencode.ai/v2/docs/config
[d-agents]: https://opencode.ai/v2/docs/agents
[d-skills]: https://opencode.ai/v2/docs/skills
[d-plugins]: https://opencode.ai/v2/docs/build/plugins
[d-server]: https://opencode.ai/v2/docs/build/plugins/server
[d-rpc]: https://opencode.ai/v2/docs/build/plugins/rpc
[d-client]: https://opencode.ai/v2/docs/build/client
[d-sdk]: https://opencode.ai/v2/docs/build/sdk
[s-tag]: https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.1.4
[s-session-protocol]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/session.ts
[s-session-handler]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/server/src/handlers/session.ts
[s-session]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session.ts
[s-session-operations]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/session.ts
[s-session-schema]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/session.ts
[s-subagent]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool/plugin/subagent.ts
[s-move]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/move.ts
[s-opencode-tool]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool/plugin/opencode.ts
[s-shell-tool]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool/plugin/shell.ts
[s-shell]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/shell.ts
[s-config-instruction]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/config/plugin/instruction.ts
[s-discovery]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/instruction-discovery.ts
[s-instructions]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/instructions/index.ts
[s-instruction-state]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/instruction-state.ts
[s-message-updater]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/message-updater.ts
[s-history]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/history.ts
[s-nested]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/instructions.ts
[s-entry]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/instruction-entry.ts
[s-projector]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/projector.ts
[s-runner]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/llm.ts
[s-execution]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/execution.ts
[s-instance]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/instance.ts
[s-builtins]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/instructions/builtins.ts
[s-context]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/context.ts
[s-metadata]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/session-metadata.ts
[s-events]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/session-event.ts
[s-event-protocol]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/event.ts
[s-event-manifest]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/event-manifest.ts
[s-create-test]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/test/session-create.test.ts
[s-worktree-protocol]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/worktree.ts
[s-worktree-schema]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/worktree.ts
[s-worktree-events]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/worktree-event.ts
[s-worktree]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/worktree.ts
[s-worktree-git]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/worktree/git.ts
[s-bus]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/bus.ts
[s-event-tables]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/event/sql.ts
[s-server-routes]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/server/src/routes.ts
[s-cli-server]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/cli/src/server-process.ts
[s-cli-api]: https://github.com/anomalyco/opencode/blob/v2.1.4/packages/cli/src/commands/handlers/api.ts
