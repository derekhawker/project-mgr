# Proposed ticket/session operating contract

**Status:** proposed requirements for review; not installed agent instructions or
an implementation plan. This specifies the integration behind the
[idea-first product proposal](idea-first-project-mgr-proposal.md). Tool and
instruction identifiers introduced here are proposed names, not existing APIs.

**Confirmed scope:** tickets are Markdown records independent of code checkouts.
Deliver one release with current-workspace migration, single-repository ticket
execution, preservation of notes/conversations, and optional tickets. New and
existing Workspaces without a linked repo get an ordinary local repo under the
selected directory convention; historical file/session paths are retained. Coordinated
multi-repository execution is deferred to release two. The later
[readiness assessment](idea-first-implementation-readiness.md) records the
authorized isolated experiments and their accepted or limited conclusions.

The user selected unlink-and-cleanup, rather than legacy conversion/presentation,
for excluded multi-repository Workspaces. Cleanup removes obsolete Workspace
artifacts and symlink aliases while preserving actual repositories/checkouts and
`~/OpenCode Projects/Repositories`. Use the
[confirmed cleanup boundary](idea-first-project-mgr-proposal.md#single-release-migration-and-retained-scope);
this is not an instruction to remove a directory or database record now.

## What must be reliable

Project-mgr must learn about work performed inside OpenCode without requiring
the human to repeat it in the GUI. Three different mechanisms do different jobs:

1. **Instructions route the agent's work:** which record to read, what to do
   before implementation, when to checkpoint, and when to request verification.
2. **Guarded tools commit product decisions:** ticket changes, execution claims,
   approval records, and verified resource associations go through Rust.
3. **Runtime observation discovers actual activity:** native tool operations,
   session moves, children, Git state, and pending input are observed even if
   the agent omitted a reporting step or followed a repository reference.

An instruction is not an event subscription. An event is not authorization. A
successful agent turn is not ticket completion. None substitutes for the others.

The first release of this integration must support a fully **managed ticket
session** with all three mechanisms. A separately labeled **observed external
session** may lack lifecycle reporting or synchronous guards; it must not appear
equally managed. A special planning/orchestrator agent is optional; the bridge
and work-record protocol are not optional for managed ticket sessions.

**Review clarification:** the user requires a working plugin, not an OpenCode
host modification that prevents work after deliberate plugin removal. Treat a
missing plugin as an integration fault with a visible repair/reconciliation path.
Do not turn protection against its removal into a release prerequisite.

Robustness is the requirement: preserve durable session links across reloads;
make event-driven updates idempotent; report adapter/store failures clearly; and
reconcile current session/Git facts after reconnect. Retry record updates by
operation ID, but reconcile uncertain native side effects before retrying them.
The existing mutation/recovery sections define those mechanisms; this does not
call for another supervisor or enforcement service. A lost connection is not a
`session.idle` event: show unavailable/stale activity until verified rather than
inventing a ticket transition. Plugin failures must not delete ticket links,
start a replacement conversation, or silently report successful tracking.

### Where the integration lives and when it runs

Recommend a service-side bridge plugin installed once for the chosen OpenCode
connection, available across bound session Locations. A workspace-local plugin
is insufficient: moving into a native worktree can leave its discovery scope.
Global installation does not mean global ticket behavior; only verified bound
sessions receive the ticket bootstrap, role-specific tools, and phase guidance.
Recheck capability availability after every move or relevant config reload.

The plugin is an adapter/observer, not a second product database or business
logic owner. Rust owns the persistent ticket/binding/operation service. The
service-side adapter must keep committing observed operations while the GUI is
closed; a GUI event listener cannot be the sole collector. The GUI reloads those
committed facts when opened and subscribes while present. The recommended shared
Rust core and one-shot adapter satisfy the proposed transport boundary without
depending on a Tauri window or adding a project-mgr daemon. The user selected
OpenCode's shared service, also used by the CLI: project-mgr attaches as a client,
and app quit must leave agent work and the plugin running. Reopen reconnects to
the same sessions without resubmitting their starting prompts. App-owned shell
terminals have separate process ownership; their persistence is not implied.

Inventory reconciliation runs while a registered observer is alive: during
OpenCode service operation for managed sessions, or during app/explicit CLI
inspection for observer-only external sessions. When no collector was active,
make no historical attribution promise; scan current state on reattachment and
expose unresolved gaps. Installing the bridge midway through a conversation
does not prove what earlier tools or instructions did.

## Why the reference-document case matters

The Simgame instruction chain is concrete:

| Entry | Invocation condition | Resulting obligation |
|---|---|---|
| Repository `AGENTS.md`, Work Routing | A user selects ticket work. | Load `gated-implementation`; read the local ticket workflow. |
| Local `ticket-management/SKILL.md` | Capture, groom, execute, resume, validate, or close a selected ticket. | Select the appropriate local references and shared execution skill. |
| `references/repository-workflow.md`, Execution And Recovery | Before implementation edits. | Create or enter a dedicated ticket worktree and branch; verify path/base/status. |
| `references/execution.md` | Each implementation slice. | Delegate test-first and validation work to a build child with limited ownership. |
| `references/closeout.md` | Human verification is complete. | Land implementation, remove the worktree, then close/archive the ticket. |

The parent followed that chain and invoked OpenCode's native worktree creation
and session move. Worktree creation was **agent behavior induced by project
policy**, not a project-mgr creation action or an unconditional OpenCode feature.
[S1, S2]

Therefore, native provisioning cannot be visible only when the user presses an
app button. Observation must cover the native operations available to a bound
session, including operations reached through Code Mode. A stronger pointer to
“report your worktree” is useful guidance, but is not a sufficient tracking
mechanism.

## Authoritative records and identities

Persist the exact OpenCode session ID to ticket/role association when the session
is linked, before its first managed ticket turn. Resume looks up that existing
association; it neither selects a ticket from GUI focus nor recreates the link
from conversation text. A missing expected association is a linking/recovery
defect. Refreshing current scope/status is separate from preserving identity:
history may contain an older ticket brief even when the durable link is intact.

| Record | Required meaning | Authority |
|---|---|---|
| Ticket | Stable ID; record revision; scope revision; lifecycle; decisions; acceptance; evidence; next action. | Independent project-mgr ticket store. |
| Approval | Human decision for one scope revision and activity, plus applicable delivery permissions. | Human action recorded by Rust, not an agent's assertion of approval. |
| Session binding | Service/session ID; ticket ID; optional run ID; owner/worker role; mode; binding generation. | Rust binding store. OpenCode metadata is only a correlation hint. |
| Run | Ticket and approved scope revision; designated owner session; preparing/executing/review/delivery/stopped state; checkpoints. | Rust run store. |
| Resource operation | Operation ID; originating binding generation/session/tool-call ID; repository; kind; intended action; pending/verified/uncertain/failed result. | Rust operation record plus observed external facts. |
| Execution context | Canonical path; verified repository/common Git directory; branch/base; origin and attribution evidence; usage; cleanup authority. | Git/filesystem facts, associated by Rust. |

Canonical ticket fields live in Markdown; SQLite may keep derived indexes but
cannot independently overwrite ticket content/lifecycle. Durable bindings,
operation intents, human-action receipts, and migration/recovery records are a
separate operational authority. Verified approval is not reconstructed merely
because someone edited a Markdown status to Ready. Coordinated backup and
recovery must preserve the distinction without pretending file replacement and
database commit are atomic. See the
[runtime/storage experiment report](ticket-runtime-storage-experiments.md).

### Workspace context without an active ticket

Bindings must distinguish **workspace conversation** from **ticket owner/worker**.
A workspace-context binding identifies workspace ID, exact verified context, allowed
activity, service/session ID, and binding generation; it has no invented ticket,
run, scope approval, or Git requirement. It supports discussion and explicitly
requested notes maintenance within that collection. Workspace capture can create
a Draft, but ticket lifecycle/execution tools require an explicit ticket binding.

Zero-ticket workspaces also retain existing repository conversations at their
recorded actual checkout/worktree locations. Migration does not fabricate a
ticket/run, move those sessions to a notes home, or require a ticket merely to
restore their history. New ticket binding is an explicit later choice.

Both new and existing Workspaces without a linked repository receive an ordinary
local repository under the [directory convention](idea-first-project-mgr-proposal.md#opencode-projects-directory-and-repository-locations).
That checkout supplies the initial context for future sessions, without a second
Workspace-home directory or ticket requirement. Existing notes/files and exact
historical session locations remain retained contexts; creating the repo does
not move them. Repository creation follows explicit Workspace creation or the
approved repo-free Workspace migration, not standalone idea capture.

A notes collection is useful without any session. Its optional tickets live in
the independent Markdown store and reference the collection/selected notes.
When one is approved for document work, use the notes directory as the run's
non-Git execution context. Branch, worktree, commit, and merge preconditions are
inapplicable, not missing setup errors. Human review and evidence match the
document outcome; code-specific validation and testing delegation are not
universal requirements.

First-release runs choose at most one repository or a non-repository directory.
Migration of eligible workspaces creates zero tickets and preserves exact paths,
conversations and workspace lifecycle provenance. Existing multi-repository
workspaces are excluded from conversion and follow the separately scoped
unlink-and-cleanup policy, not a forced single-repository ticket mapping.

Record revision detects concurrent edits. Scope revision changes only when the
approved outcome, boundaries, or consequential decisions change; adding test
evidence does not itself invalidate scope approval. Operation IDs make bridge
retries idempotent; they do not magically make OpenCode's native worktree API
idempotent. [S3]

OpenCode's hook call-ID field is `id`. Code Mode inner calls share the outer
call ID, including repeated/concurrent calls to the same tool. Therefore an
operation ID must be allocated inside each retained executor invocation and
held in that invocation's closure; the native call ID is supporting provenance,
not an idempotency key or a unique inner-operation identity. [S4]

The session binding is independent of GUI selection and survives a directory
move. Parent/child ancestry, inherited metadata, matching names, or temporal
proximity alone cannot grant mutation or cleanup authority. Rebinding an owner
requires a safe boundary and a new binding generation; existing workers keep
their old assignments until explicitly reconciled.

## Instruction ownership and invocation

There should be an inventory of instructions, not an assortment of overlapping
`AGENTS.md` additions. The proposed division is:

| ID / packaging | Owns | Loaded or invoked when | Completion criterion / limit |
|---|---|---|---|
| **Session bootstrap**, `project-mgr-session` instruction entry | Ticket/store reference, binding generation, role, mode, required tools, entry skill, and instruction/policy versions. | Bridge installs it before the first managed turn; reconciles it on resume, mode/binding change, and location change. | Binding and live record access agree; required entry skill is available. Contains orientation, not a duplicate ticket or another execution plan. |
| **Workspace notes skill**, proposed `project-mgr-workspace` | Workspace identity, notes/document roots, explicit notes-maintenance request, relevant guidance, and optional ticket capture. | Explicitly attached for a managed workspace conversation with no active ticket; replaced by the ticket entry only on explicit ticket binding. | Requested notes outcome recorded in the files/conversation; no fabricated ticket/run or Git setup. Substantial tracked work routes to ticket capture when the user selects it. |
| **Global ticket router skill**, proposed `project-mgr-ticket` | Select the capture, shape, execute, review/delivery, or recovery procedure; require ticket checkpoints. | Explicitly attached/activated for each managed owner session before its first ticket turn. Bootstrap requires re-entry on resume or mode change. Description remains a discovery fallback for manually attached sessions, not the readiness guarantee. | Correct branch reference has been read and the authoritative record opened before that activity. It cannot approve work or perform Git effects merely by loading. |
| **Phase references** under that skill | Ordered steps and checkpoint/tool obligations for one activity. | Router opens the exact reference for the current branch, as specified below. | Phase-specific committed checkpoint or named blocker/human decision. They are instructions, not runtime hooks. |
| **Shared `gated-implementation` skill** | Scope, approved execution loop, empirical validation, recovery, human verification. | Execute reference invokes it at approved implementation/experiment start; recovery invokes it when resuming that approved work. | Existing process retained, but it must accept a tool-addressed durable record before being reused here; today it explicitly expects a file. |
| **Repository `AGENTS.md` and registered policy references** | Domain meaning, project validation, required isolation, delegation limits, delivery practice. | OpenCode discovers actual checkout instructions; phase references explicitly read the relevant policy branches before their governed operation. Reconcile versions after a location change. | Required project-specific choices and checks are known. A local storage/index convention cannot silently replace the bound ticket store. |
| **Worker brief**, proposed `project-mgr-worker` skill plus assignment | Ticket/run reference, assigned slice, allowed edits, proof, reporting method, and escalation boundary. | Attach before the child's first assigned turn; refresh on reassignment. Existing children do not automatically inherit a later parent change. | Child reports assigned results or a named failure; it cannot change ticket lifecycle, expand scope, approve work, or perform owner-only delivery. |
| **Tool descriptions** supplied by the bridge | Each operation's preconditions, side effects, commit result, conflict/recovery behavior. | Available whenever managed tools are enabled. | A model can tell admitted/pending from committed/verified. Descriptions are not the authoritative transition implementation. |
| **Permission and transition policy in Rust/runtime integration** | Actual write authority, role, revision/approval checks, operation guards. | Every managed mutation; not only at startup. | Invalid operations rejected before their controlled side effect. This is executable policy, not agent guidance. |
| **Observer/reconciler** | Actual resources, session state, activity, and discrepancies. | Native events, intercepted operations, reconnect/startup, explicit refresh, and periodic reconciliation. | Validated facts reach the store/UI or an explicit uncertainty is exposed. It never waits for a skill to be invoked. |

These instruction IDs are namespaced to avoid colliding with a repository's
existing `ticket-management`. Global means reusable installation, not mandatory
behavior in every unrelated OpenCode conversation. Scope the bridge instructions
and mutating tools to verified bindings. Do not place ticket IDs or scope
approval in global `AGENTS.md` or generate a new repository-wide workflow.

### Concrete OpenCode entry points

For v2.1.4, recommend the documented `ctx.session.hook("context", …)` to refresh
the compact binding before each primary model request, including tool
continuations. Use `ctx.session.hook("prompt", …)` as the narrower admission
boundary for a new prompt and managed child binding. Explicitly attach the entry
skill through the validated prompt/skill mechanism; normal turn continuations
retain its OpenCode-owned history, while resume/mode changes re-enter its router.
Tool mutations always recheck live Rust authority even if the model saw an older
instruction snapshot. [S4]

Those session hooks have no documented typed policy-denial result in the pinned
API. The installed experiment confirmed rejection before primary dispatch and
same-child recovery in the foreground native path. It also exposed empty HTTP
500s for some admission failures and successful admission/wait responses around
a context error recorded in assistant history. Production must provide a named
readiness failure and retry path rather than treating HTTP admission as success.
An asynchronous `session.created` subscriber is not the gate. If a required
native admission path fails, stop the affected dispatch and diagnose that seam;
explicit create-bind-context-prompt dispatch may serve as a recovery/experiment
path, but cannot silently substitute for the required native-subagent release
acceptance. Do not rely on after-tool observation to bind a child that may
already be generating. Removing the plugin defeats this hook gate altogether;
the user accepted that boundary and requires a robust working plugin, not a
host-level guard against deliberate removal. [S4, S7]

Current online docs also show a plugin instruction-entry convenience API that
the pinned v2.1.4 plugin interface lacks. Validated experimental HTTP instruction
entries are another possible storage mechanism for bootstrap text, but are not
themselves an execution barrier. This proposal chooses context/admission hooks
as the primary runtime mechanism, not that unavailable convenience method. The
managed gate covers ticket-related primary turns and mutations; title,
compaction, and transient generation hooks need separate treatment if the
implementation promises equivalent context there. [S4]

### Explicit router branches

The router must name each trigger and target. Proposed reference names below
describe the future instruction package, not files created by this proposal.

| Trigger | Reference invoked | Required ordered actions | Stop/hand-off condition |
|---|---|---|---|
| Capture an unselected idea | `references/capture.md` | Read applicable project context if supplied; check duplicates; save a small Draft through the store. | New/existing ticket ID returned; no execution selected. |
| Discuss or groom a selected ticket | `references/shape.md` | Open bound record; read source/policy only as authorized; resolve intent and uncertainty; update decisions/scope through the store. | Current draft checkpoint plus unresolved decisions, or human approval requested for a specific scope revision. |
| Start approved implementation or an approved experiment | `references/execute.md` | Open record; invoke adapted `gated-implementation`; read project isolation/testing rules; claim a run; acquire/verify context; execute and checkpoint slices. | Committed review request, blocker, approval-needed checkpoint, or explicit stop. |
| Review, verify, deliver, or close selected work | `references/review-and-delivery.md` | Read acceptance/evidence and local verification/closeout rules; request human verification; perform only authorized delivery; record each side effect and final result. | Verified ticket Done, or retained Review/Blocked state with missing obligations stated. |
| Resume after interruption, conflict, move, missing context, or failed operation | `references/recovery.md` | Reopen ticket/binding/run; reconcile actual sessions/resources and approvals; classify pending operations; invoke the appropriate current phase. | Known safe next action or explicit unresolved discrepancy; never blind replay of provisioning or delivery. |

Loading the shared implementation skill during shaping must not authorize
execution. Likewise, a repository reference may impose a worktree requirement
but cannot create human approval that does not exist in the ticket store.
Before adopting a repository's existing workflow, identify conflicts such as
Simgame's `_tickets/` status/index writes and adapt those specific references.
Do not install two competing instructions and expect the model to choose.

## Bridge operations and execution authority

All mutating operations below are **proposed logical contracts**. They may be
exposed as OpenCode tools and user commands; their wire schema is a later task.
Their business semantics are specified here rather than delegated to prompts.
Both GUI and terminal paths must reach the same Rust service.

| Operation | Caller | Preconditions and committed result |
|---|---|---|
| `work.capture` | Human; agent explicitly asked to capture | Save an intentionally authored idea as Draft, with optional grouping/repository references. No approval, execution run, or active-session rebind follows automatically. GUI capture works without OpenCode; opted-in agent capture can start without an active ticket binding. |
| `work.open` | Bound owner or worker | Resolve caller binding, return current ticket/role/mode/revisions and allowed actions. Reads do not change lifecycle. |
| `work.update` | Owner; human through GUI/CLI | Expected record revision; patch authored scope/decisions/next action. Material scope changes invalidate old execution approval and stop affected new managed mutations. No arbitrary lifecycle or approval field writes. |
| `work.checkpoint` | Owner; worker for its assignment | Run/assignment and operation ID; record progress, evidence references, limitations, and next action. Owner integrates worker results. Child checkpoints cannot finish the ticket. |
| `work.assign` | Owner | Create a bounded worker assignment for the current ticket/run/scope, allowed changes and required evidence. Return an assignment ID for dispatch/binding; preserve the actual task prompt in OpenCode, not the product operation journal. |
| `work.request_decision` | Owner | Request a human scope/verification/delivery decision bound to exact revisions/run and a unique request ID in the same terminal. Return existing valid approval or pending request on retry, not a duplicate form or approval. The request itself grants no authority. |
| `work.begin` | Owner, following human approval | Current approved scope/activity, no conflicting owner claim, compatible policy. Complete a recoverable journaled transition: reserve the run, install the Markdown In-progress revision, then finalize the run Preparing/authority receipt. Pending state grants no implementation authority; no cross-resource atomic transaction or automatic worktree is implied. |
| `work.block` | Owner, human, or plugin's owner-idle handler | In-progress run; reason, last useful state, resolution condition, next step. For the automatic idle rule, Rust supplies `session_idle` and awaiting-continuation metadata from the verified owner binding. Persist Blocked and retain resources. A subagent reports a blocker to its owner instead. Unresolved draft questions remain draft decisions, not an implied execution blocker. |
| `work.request_review` | Owner | Reconcile assigned work; record required validation, limitations, and verification path. Persist Review; does not claim human acceptance or delivery. Missing required automated work remains In progress with a checkpoint. |
| `work.record_delivery` | Owner within separately recorded authority | Store verified commit/merge/context disposition facts for that run. Delivery failure retains Review with an explicit failed/pending delivery step. |
| `work.finish` | Owner or human | Current human acceptance and required delivery obligations verified. Persist Done exactly once. No implicit commit, push, merge, or deletion. |
| Approve scope, verify/reject result, cancel, reopen, transfer/rebind | Human | Explicit action tied to ticket/scope/run as applicable; update authority and lifecycle through the same store. Agent may request the action but cannot attest that the human performed it. |

Caller session and role come from verified bridge/runtime context, not an
agent-supplied `sessionID` or ticket ID alone. Each mutation checks binding
generation, expected revision where applicable, and idempotency key. Return the
committed revision and state, or a conflict/rejection with a next action. A
queued request or prose answer is not a successful store write.

Capture-only entry is the narrow exception to requiring an already-bound ticket:
the user explicitly invokes capture, the service verifies that session/action,
and the tool can create/link a Draft but cannot mutate existing ticket scope,
provision resources, or start execution. Selecting the returned ticket for
discussion then establishes the normal binding/readiness sequence.

Use a Rust-owned headless entry point shared with the app so the plugin/CLI can
operate while the GUI is closed; no business logic or separate lifecycle store
lives in the JavaScript plugin. The
[runtime experiment](ticket-runtime-storage-experiments.md) supports a one-shot
versioned JSON-stdio Rust adapter as the recommended default; GUI commands call
the same Rust core in process. This avoids a new project-mgr listener/daemon and
does not require an open Tauri window. Package/configure the correct absolute
binary/store paths independently of session cwd, and bound launch concurrency,
input/output, cancellation, and deadlines. Real plugin-to-Rust authority checks
and platform packaging remain production acceptance work.

Private pipes are transport, not proof of a human or OpenCode session. Same-user
shell access is not an adversarial security boundary; stronger enforcement
requires restricted capabilities, not just caller labels.

### Markdown mutation and operational commit boundary

Every lifecycle operation that changes Markdown and operational authority uses
the same logical pattern: take the cooperating-writer lock; verify revision,
scope and authority; stage/sync intended Markdown; commit an operation intent;
apply the validated mutation; revalidate/finalize operational authority; return
a committed receipt. This is logical ordering, not a cross-resource transaction. Release locks before long native effects
or human decisions.

Crash/reopen recovery compares actual bytes with the journal's base/intended
hashes and preserves mismatches for reconciliation. Revalidate bindings, scope
approval and revocation before completing authority-bearing work; mechanical
byte recovery alone is not authorization. While incomplete, show pending/uncertain
state and withhold implementation capability until recovery completes. Never claim SQLite rollback undoes a file
replacement or that an operation receipt proves the current file is unchanged.

The executed prototype supports cooperating writers and process-crash recovery, not power-loss durability or this full lifecycle protocol. [S6]

### Human decisions inside the OpenCode conversation

**User-approved interaction:** approval and verification use OpenCode's session
forms without leaving the terminal. The bridge offers a form bound to the exact
ticket, scope revision/run, decision, and requested delivery permissions. Rust
accepts the result only from the verified human-action path. The model may
prepare the request but cannot invoke an agent tool to self-approve it.

Free-form “go” or “verified” can cause the agent to request that action; the
agent's interpretation of prose alone is not a machine-verifiable approval
receipt. This adds one explicit boundary when needed, not another approval for
each slice. Existing valid approval is reused. The user approved this structured
action at scope and acceptance boundaries; custom text commands or per-task
approval prompts are not required alternatives.

**Selected implementation direction, not yet built:** use OpenCode's
existing session forms, rather than inventing text commands that the agent must
parse. The published [V2 API](https://opencode.ai/v2/openapi.json) provides form
create/get/reply/cancel and `form.replied` events. The proposed flow is:

1. The owner requests scope approval or result verification through a plugin
   tool. Rust records a pending decision for the bound ticket/session, exact scope
   or reviewed-result revision, allowed choices, and a unique request/form ID.
2. The plugin creates that session form through
   `POST /api/session/{sessionID}/form`. Its title/choices identify the decision:
   Approve plan / Request revisions, or Accept result / Request changes.
   The form references the existing agreed record, not another copied plan.
3. The human answers through OpenCode's terminal form UI. The plugin observes
   `form.replied`, matches it to the registered request, and reads current form
   state if needed. Metadata supplied by the model is not authority to select
   another ticket or approve an unregistered request.
4. Rust verifies that the request remains pending and that the reviewed scope or
   result has not materially changed. It records the answer once and commits the
   corresponding ticket/authority update. A stale form requires a new current
   decision, not application of an old approval to new work.
5. The waiting plugin tool returns the committed outcome, allowing the existing
   OpenCode loop to continue or revise the work. Creation of an external form
   alone does not imply automatic agent resumption. Cancellation grants nothing;
   reconnect checks persisted request/form state instead of duplicating approval.

Approve covers the agreed complete plan, not a new prompt for every task. Accept
records verification of the reviewed result; it does not bypass the separate
delivery obligations required before Done. API availability is established;
this decision workflow and native terminal presentation have not been
implemented or validated end to end. Product approval of the interaction does
not establish that runtime validation or authorize production implementation.

This is an auditable client-decision design, not a demonstrated independent
human-identity guarantee. The pinned form reply/schema records an answer but
does not itself distinguish a human from another client with equivalent server
authority. The implementation must define and validate the trusted action path;
same-user shell/API access remains outside an adversarial isolation claim. See
the [review note and primary sources](idea-first-implementation-readiness.md#human-decision-ux-to-review).

## Ticket status and session activity are different

Ticket lifecycle is written through the Rust operations above, including
plugin-triggered updates. Session activity is an observed overlay: Running,
Waiting for input, Idle, Failed, or Unknown, with
last observation and bridge/reconciliation health. For example, **In progress ·
waiting for permission** and **Draft · discussing** are valid combinations.

| Ticket transition | Who initiates it / evidence | Invalid inference |
|---|---|---|
| New → Draft | Human capture, or explicitly requested agent capture committed to the store. | A session title or every user message becomes a ticket. |
| Draft → Ready | Human scope approval for a bounded outcome with required readiness information. | A polished draft or loaded skill implies approval. |
| Ready → In progress | Owner's accepted `work.begin` for that approved scope/activity. | Creating a terminal, reading code, or merely creating a worktree means implementation began. |
| In progress → Blocked | The plugin observes `session.idle` for the linked owner session and requests a Rust transition with reason `session_idle`; owner/human may also record an explicit blocker. | An unrelated session or subagent becoming idle blocks the owner's ticket; idle invents a specific failure or means completion. |
| Blocked → In progress | For an idle-derived block, the linked owner resumes execution under valid approval. For an explicit blocker, verify its resolution; human resolves intent/authority blockers. | New activity clears an explicit unresolved blocker or grants new approval. |
| In progress → Review | Owner's accepted review request with required evidence and manual path. | An idle/succeeded OpenCode turn means the work is ready. |
| Review → In progress | Human rejects acceptance or owner resumes an identified in-scope defect; approval remains valid. | Every refinement requires another ticket or approval. |
| Review → Done | Human acceptance recorded; required delivery verified; `work.finish` committed. | Agent says “done,” tests pass, or worktree disappears. |
| Ready/In progress/Review → Draft | Material scope change invalidates approval; owner/human records what needs a decision. | A routine progress update invalidates all approval. |
| Any open state → Cancelled | Explicit human cancellation with retained-resource disposition recorded. | Closing the terminal or quitting the app cancels work. |
| Done → Draft/Ready | Explicit human reopen with a stated reason; fresh approval if scope changed. | A stale child checkpoint reopens or overwrites finished work. |

An approved experiment uses its own bounded approval and execution mode. Its
completion does not approve production implementation. Read-only research can
remain a Draft activity unless the human explicitly selects a bounded execution
episode; typing **Discuss** never calls `work.begin` automatically.

Required owner checkpoints occur after scope approval/change, before the first
controlled implementation effect, after each meaningful slice/validation result,
on blocker/discovery, before review, after each delivery step, and before an
intentional handoff. Normal activity logs are not ticket checkpoints.

**User-selected idle fallback:** an executing ticket becomes Blocked when its
linked owner emits `session.idle`, with the factual reason “Session idle;
awaiting continuation.” Do not require the model to report a blocker first.
Preserve an already recorded Draft, Ready, Review, Done, Cancelled, or explicit
Blocked state; an idle event does not overwrite those outcomes. Duplicate events
are harmless, and stale events from an old binding or a session already running
again must not overwrite newer state. A subagent's idle event updates that
subagent's activity, not the owner's ticket lifecycle.

If an expected checkpoint is missing, retain that diagnostic alongside the
automatic Blocked state rather than leaving the ticket falsely In progress.
On reconnect, reconcile the linked session's current activity through the same
Rust rule; no assumption of complete event replay is required. This event-driven
fallback is the product decision; its production behavior has not yet been tested.
The published [V2 event schema](https://opencode.ai/v2/openapi.json) exposes
`session.idle` with `data.sessionID`, allowing exact-session lookup.

Track that expectation from controlled effects and outstanding phase obligations,
not from every chat message. A turn that performs a managed write/context
operation, integrates an assignment, or reaches a requested review/delivery
boundary needs a checkpoint covering those operation IDs. A question-only turn
does not. The check runs at the owner-turn boundary, not between every tool call
in a slice; it should not turn progress recording into a new approval loop.

## Native worktree tracking protocol

### Detect an operation independently of agent narration

The managed bridge must observe native worktree create/remove, session move,
and child creation paths available to a bound session. It must associate a
native call with its **runtime session and call ID**, including calls inside
`execute`. Checking only the outer Code Mode tool name is insufficient.

The pinned v2.1.4 public `ctx.tool.hook("execute.before", …)` and
`"execute.after"` hooks cover the inner native calls, not just `execute` itself.
Use `ctx.tool.transform` to retain and wrap the effective
`opencode_worktree_create`, `opencode_worktree_remove`, and
`opencode_session_move` executors. The wrapper verifies final decoded arguments,
allocates its own operation ID, obtains a durable pre-effect receipt from Rust,
calls the original native executor once, and records sanitized result/error
facts using that same operation ID. Preserve the native schema and provisioning
strategy; the registry transform itself is synchronous registration, not the
place to perform operation-time I/O. [S4]

Before hooks supply common preflight and after hooks additional observation,
but after hooks are not guaranteed finalizers: before rejection, interruption,
crashes, defects, or earlier failing hooks can prevent notification. Later hooks
can also modify arguments after an earlier before hook ran. The retained
executor wrapper and pending-operation journal, not hook pairing by `id`, own
critical authorization and correlation. [S4]

Native `subagent` is a direct tool and is not normally exposed in Code Mode in
this version. Its preflight/reuse check belongs on that actual tool, with the
separate child admission gate described above; do not invent a
`tools.opencode.subagent` API. Permission-evaluation hooks alone are insufficient:
native create/move do not assert the permission action needed to reach them.
[S4]

These seams were exercised against installed v2.1.4 through real Code Mode and
native Git operations in isolated fixtures. They are not production Rust-journal,
authority, packaging, or native GUI acceptance. If
the installed version or another plugin prevents effective wrappers/gates, route
managed context mutations through bridge-owned tools calling the native API and
omit the unobservable capability, or require an OpenCode change. Never advertise
reliable tracking while silently missing an allowed invocation path. The
[focused research](opencode-tool-observation-research.md) specifies hook fields,
Code Mode correlation, registration ordering, and failure limits.

Direct management-API calls, another plugin's operations, subprocesses, and Code
Mode's separate `fetch` primitive do not become registered native-tool calls.
Their effects require inventory/session reconciliation and may remain
unattributed. If those paths remain unrestricted, the managed guarantee is
**guarded native-tool tracking plus reconciliation**, not universal prevention
or attribution of every filesystem/API effect. Stronger restrictions need an
explicit supported capability boundary. [S4]

### Normal sequence: a reference instructs the agent to create a tree

1. The owner has loaded the execute reference and local isolation policy, and
   `work.begin` has committed the run. No worktree exists merely because the run
   is Preparing.
2. A repository reference leads the agent to call native worktree creation.
   Before the native side effect, the bridge checks the session binding, current
   approval, allowed repository, and role. It durably records the operation ID,
   native call ID, requested source/base facts, and pre-operation inventory.
3. The native OpenCode operation creates the tree. Project-mgr does not create
   another one. The event `worktree.updated` independently invalidates that
   project's inventory; it is not the operation's attribution receipt. [S3]
4. Result observation obtains the actual returned path. Rust verifies Git
   identity/common directory, canonical root, actual branch/base, and ownership
   evidence; it commits the operation/context association. A detached worktree
   is recorded as detached, not assumed to satisfy a named-branch policy.
5. The parent may next create the required branch or move its session. Reconcile
   resulting Git facts and `session.moved`/session readback before marking that
   context ready. A move tool's admission is not proof the move was applied. [S3]
6. Subsequent managed implementation operations use the verified context. The
   ticket remains In progress; the run can now become Executing. The UI learns
   through store change notifications/reload, not through model-written prose.

If the agent skips `work.begin`, the managed mutation guard rejects the native
operation with a route to claim the approved run. If the agent follows all the
local reference steps but never says “I created a worktree,” tracking still works.
An observer-only external session is handled by discovery below, not given this
pre-effect guarantee.

### Observation and attribution matrix

| Observation | What project-mgr learns | What it may associate automatically |
|---|---|---|
| Verified native call/result with bound runtime session/call ID | Actual creation/removal attributable to that session's run. | Operation/context to run after Git validation; cleanup authority only if separately granted. |
| `worktree.updated` plus inventory re-list | A project's known inventory changed. | Resource discovery only; the event has no ticket/session attribution. |
| `session.moved` plus current session record and Git validation | A known session now uses a specific context. | Usage by that session/run; not proof that it created or owns the tree. |
| `session.created` with known parent | A child conversation exists at its actual location. | Candidate assignment; bridge must verify explicit assignment/role before granting writes. |
| Change in `git worktree list --porcelain` for a monitored repository | A tree was created/removed outside native inventory, including shell Git. | Discovered resource; unknown creator stays unassigned unless confirmed or independently evidenced. |
| Matching branch/name, close timestamps, or agent prose | A possible association or claim. | Suggestion only; never automatic ownership, approval, cleanup, or completion. |

The discovery loop subscribes to relevant OpenCode events and re-reads affected
records/inventories; it also compares actual Git worktree lists at startup,
reconnect, explicit refresh, before resume/review/cleanup, and periodically while
monitoring active repository contexts. Proposed default background interval is
30 seconds; its cost and latency require measurement. If a scan is unavailable,
show stale/unknown with last successful observation rather than “up to date.”

Scan only explicitly registered repository/common-directory contexts, including
adopted clones. Native inventory listing does not discover every shell-created
tree, and remote identity alone cannot tell which clone owns a worktree. Do not
silently call the plugin-loading/mutating worktree refresh API as a read-only
inventory check. [S3]

### Partial failure and safe retry

- **Creation succeeded; startup command failed:** inventory and Git may contain
  the new tree despite an API error. Mark the operation uncertain/setup-failed,
  reconcile the resource, and offer continuation on that tree. Never assume no
  side effect. [S3]
- **Crash after creation, before result association:** reopen the durable pending
  intent, compare current facts, and associate only when evidence identifies the
  result. Concurrent plausible creations remain unassigned; ask for confirmation
  rather than create another tree or guess by name.
- **Bridge store unavailable:** reject new controlled context mutations before
  effects. Already-running external work may continue; show degraded health and
  reconcile on return. An unrestricted shell remains outside this guarantee.
- **Result was not acknowledged:** retry the bridge operation by operation ID.
  If native completion is uncertain, reconcile first; do not replay native
  provisioning as though it had an idempotency key.
- **Tree removed externally:** retain the ticket, history, operation, and last
  verified context. Mark it unavailable, including affected children. Do not mark
  the ticket Done, recreate the tree, or rebind sessions automatically.

For a move naming another session, authorize both the runtime caller and target
binding; one ticket owner cannot move an unrelated session by supplying its ID.
Serialize managed moves per target and record Requested → Admitted → Applied/
verified, resolving the actual canonical location from session readback. Confirm
application outside the originating tool call: a current-session move may need
that call to finish before it can apply. Conflicting external moves remain a
visible supersession/discrepancy, not a fabricated acknowledgement. [S4]

For removal, verify the exact target, permitted cleanup authority, Git state,
pending operations, and active usage. Forced removal needs explicit human
authorization. Record unavailable/removed facts separately from ticket lifecycle;
a native removal result grants no permission to remove branches or stop other
sessions.

## Startup, delegation, and recovery sequences

### Select a Draft and open Discuss

1. Rust resolves ticket identity, chosen source context, and exact existing/new
   OpenCode session; no branch switch or worktree provisioning.
2. Install and verify the managed bridge in the actual session Location; persist
   owner binding in Discuss mode and install bootstrap/entry skill.
3. Attach the interactive terminal and verify readiness before submitting any
   initial user prompt. The bridge opens the live ticket before ticket work.
4. The session reads authorized project context, discusses, and commits authored
   decisions through `work.update`. Ticket remains Draft; changing GUI selection
   has no effect on that session's binding.

If there is no repository, use an explicit non-repository session context. Later
source selection refreshes project policy without resetting the ticket or
silently authorizing implementation. Existing active external sessions must
reach a safe boundary before promotion to managed mode; attaching a tab alone
does not establish the protocol retroactively.

### Continue into execution and delegate testing

1. Human approves current scope in the same terminal or GUI; store records the
   decision. Router enters execute and reads local isolation/delegation policy.
2. Owner commits `work.begin`, then native context setup follows the protocol
   above. Ticket and operation IDs remain associated through the session move.
3. Before assigned child work starts, bind the real child ID to ticket/run,
   role, slice, permitted changes, and checkpoint method. Verify its actual
   Location/instruction context. If native child creation cannot establish that
   before the first assigned turn, use a supported managed dispatch path instead
   of assuming a later hook will fix an already-running child.
4. Child reports assignment evidence; owner validates/integrates it and commits
   ticket checkpoints. Child failure updates assignment activity, not ticket
   lifecycle. Only the designated owner advances the ticket.
5. Scope changes, reassignment, and parent moves require explicit child
   reconciliation; metadata inheritance is a snapshot, not a live binding. [S3]

For native new-child dispatch, use the following proposed correlation contract:

1. Owner registers `work.assign` for a bounded worker role. Only one unconsumed
   assignment reservation per owner may be claimed by the next native dispatch;
   create further assignments after each dispatch has claimed its reservation.
   Worker execution can still run concurrently.
2. The retained native `subagent` wrapper allocates a dispatch operation ID,
   claims that reservation, and appends one versioned bridge-generated assignment
   reference to the existing native `prompt` field. It identifies assignment,
   dispatch operation, and parent binding generation; it carries no credential
   and does not add an undeclared native tool argument.
3. At child prompt admission, the plugin reads the actual child and parent IDs
   and that reference. Rust atomically verifies and claims the pending dispatch
   for this exact child, checks parent/run/generation/role, and returns the child
   binding. Duplicate admission for the same child is idempotent; another child
   claiming the same dispatch is rejected. Missing, conflicting, or fabricated
   references do not establish authority.
4. The context hook refreshes the confirmed child binding before its first
   primary request. Only then can it execute the assigned work. Failure leaves
   a pending/failed dispatch and possibly an idle child record, not an assumed
   running assignment. Never delete that conversation to conceal partial setup.
5. On native reuse, verify the existing child assignment/run and supply refreshed
   context; no reservation or inherited metadata silently rebinds an old child.

This reference is transient input to OpenCode's conversation, not a copied task
prompt or separate execution plan in the app store. Persist only the structured
assignment link/authority and operation metadata in Rust. Pair neither
concurrent identical calls nor their results by parent ID, prompt similarity,
or shared outer call ID. The exact reference encoding is a wire-format choice;
the unique dispatch/child-claim semantics are required.

The installed fixture verified this correlation seam, foreground native reuse,
concurrent exact-child claim, malformed/stale rejection, and same-child recovery.
The proposed Rust transactions, one-reservation rule, background/cancellation
interleavings, and full mutation-role authority still require implementation
acceptance; fixture role text alone is not enforcement. If a required gate fails,
explicit create-bind-context-prompt dispatch may provide a documented degraded or
recovery path, or an OpenCode extension may be required—not speculative binding
from `session.created`. Neither fallback substitutes for required native release
acceptance. [S4, S7]

### Finish while the human stays in OpenCode

1. Owner records completed scope, validation and limitations, then commits
   `work.request_review`. The workspace list now shows Review without another
   manual status edit in the app.
2. The human verifies through the bound terminal action. Rejection resumes the
   same ticket/run within scope; acceptance authorizes only the recorded actions.
3. Owner follows the local delivery branch. Observe/verify each commit, merge,
   move, and removal as applicable; commit delivery checkpoints. Failed delivery
   leaves Review with the exact outstanding step, not Done.
4. `work.finish` verifies acceptance and delivery obligations and commits Done.
   Historical child sessions remain recoverable records even if their contexts
   were intentionally removed; they cannot issue stale writes to the Done ticket.

### Reconnect or resume

Re-read ticket, binding generation, approval, pending operations, current session
locations, children/assignments, active/pending-input state, and Git facts.
Recover from current facts and committed records; historical OpenCode event
payloads may not have been retained. Refresh instructions/skill branch, expose
unresolved attribution or missing checkpoints, and allow only the next safe
operation. Event replay is an optimization, not the only recovery path. [S3]

## Conflicts and limits must be visible

- **Policy conflict:** a local instruction asks for repo-local ticket/index
  writes, different lifecycle authority, or a new consequential action. Record
  the conflict and adapt the project profile with human agreement; do not let
  that reference silently create another record or override approval.
- **Instruction loading fails:** managed session is not ready. Show missing
  bootstrap/skill/policy with a repair path; do not label a discovered skill as
  invoked. Record available provenance and acknowledge unobservable portions.
- **Agent omits a status call:** facts/activity remain observed; semantic
  lifecycle stays at its last committed value until a defined transition applies.
  In particular, the linked owner's `session.idle` commits the automatic
  In progress → Blocked fallback even without a model-written checkpoint. Retain
  a checkpoint-missing diagnostic where required; never infer Review or Done.
- **Agent reports false success:** store distinguishes reported evidence from
  independently observed facts; required human acceptance remains unmet.
- **Uninstrumented external code/shell:** discover resulting Git/context changes
  where possible; do not promise synchronous prevention, perfect attribution,
  or automatic semantic status. Strict write isolation requires an explicit
  restricted execution capability and is not delivered by worktrees or prompts.

Persist association/operation facts and intentionally authored ticket content,
not raw prompts, full tool inputs/results, or duplicate conversation history.
Use allowlisted metadata: IDs, safe validated paths/refs, statuses, revisions,
fixed error categories, and evidence references. Keep credentials and human
prompt contents out of bridge logs and generated instruction artifacts.

## Acceptance gates before claiming this protocol works

These are required production end-to-end demonstrations for a later
implementation. The isolated experiments validate several mechanisms and expose
counterexamples; they do not satisfy every release gate or claim installed
project-mgr/GUI acceptance:

1. A nested local reference triggers native worktree creation inside `execute`,
   with no agent reporting call; exactly one tree and the verified run association
   appear in project-mgr.
2. Two tickets create worktrees concurrently in one repository. Project events
   cannot swap their associations; unattributable external trees remain unassigned.
3. An approval-free Draft cannot acquire implementation authority by loading a
   skill or following a local reference. Managed controls reject the operation;
   unsupported shell paths are accurately labeled outside the guarantee.
4. Same-terminal checkpoints, human approval, review rejection/acceptance, and
   delivery update the workspace list without duplicate GUI bookkeeping.
5. A child can report evidence but cannot self-approve, finish, or mutate another
   ticket. Rebinding a parent or selecting another GUI ticket does not redirect it.
6. Failed startup after native creation, lost result acknowledgement, and bridge
   reconnect recover without duplicate provisioning or deletion of uncertain work.
7. Missing checkpoints, absent event retention, and unavailable scans expose
   stale/unknown state and recover from live facts rather than false completion.
8. Removing a tree retains ticket/history and marks affected session contexts
    unavailable; safe recovery is explicit. Native/TUI/Wayland acceptance remains
    separate from protocol and store checks.
9. Linked owner idle moves In progress to Blocked without a model status call;
   resuming approved work clears only that idle-derived block. Subagent/old-binding
   idle and duplicate/stale events do not overwrite current state, explicit
   blockers, Review or Done. Reconnect recovers the same result from live activity.
10. Tools remains reachable across ticket views, including a repo-free Draft,
    and opens the canonical Markdown independently of the execution checkout.
    Refreshing or retrying must not fabricate scope approval.

## Review decisions and remaining implementation gates

The recommended product protocol above is specific; remaining uncertainty is
not permission to replace it with a prompt-only solution. Before implementation:

- Preserve the now-executed installed-version native/child capability checks as
  reproducible regression gates and add production authority/recovery coverage.
  Require the plugin to be active and expose missing-plugin integration faults.
  The user chose a working-plugin requirement rather than host enforcement that
  survives deliberate plugin removal; polling is not claimed as prevention.
  A documented explicit fallback may provide degraded operation or recovery if a
  required native path fails; it cannot substitute for required native release
  acceptance or justify claiming native delegation was delivered.
- Implement/validate the recommended shared Rust core plus one-shot JSON-stdio
  adapter, with versioned contracts, trusted runtime capture and binding checks.
  Feasibility is experimentally supported; production packaging, authority, and
  lifecycle recovery remain acceptance work. Markdown ticket format is selected;
  operational metadata and coherent backup/recovery are separate concerns.
- Implement and validate the selected OpenCode session-form decision flow,
  including stale revisions, duplicate replies, cancellation, reconnect, and
  resumption of the waiting tool. The structured interaction is user-approved;
  production behavior remains an acceptance gate.
- Adapt the shared file-oriented implementation skill and the chosen repository
  policy references; define which versions were actually used on each run.
- Specify and validate the desired write-restriction level. Observer-only mode
  must remain distinguishable from guarded execution, not an invisible fallback.

No skill, plugin, agent configuration, service, or repository policy is installed
or changed by this document.

## Sources

- **S1:** [Session audit](idea-first-session-audit.md), especially the setup/move,
  child delegation, and closeout message references.
- **S2:** `~/programs/simgame/rust-main/AGENTS.md:53–88`;
  `.agents/skills/ticket-management/SKILL.md:13–35`;
  `references/repository-workflow.md:44–78`, `execution.md:8–56`, and
  `closeout.md:3–8`. Paths after `AGENTS.md` are relative to that skill directory.
- **S3:** [Pinned OpenCode v2.1.4 research](opencode-workflow-integration-research.md),
  especially child inheritance, move admission/application, optional event
  retention, project-only worktree events, and partial provisioning failure.
- **S4:** [Native tool observation research](opencode-tool-observation-research.md).
- **S5:** `~/.agents/skills/gated-implementation/SKILL.md:14–26,114–127,151–182`
  and `~/.agents/skills/writing-for-agents/{SKILL.md,SKILL-MECHANICS.md}`:
  durable-record assumptions, explicit pointer branches, invocation, completion
  criteria, and separation of always-loaded routing from phase references.
- **S6:** [Executable runtime/storage research](ticket-runtime-storage-experiments.md),
  including the Markdown/SQLite crash recovery boundary. [Readiness assessment](idea-first-implementation-readiness.md)
  records independent reruns and accepted conclusions.
- **S7:** [Executed session-context research](opencode-session-context-experiments.md):
  native child admission, skill attachment, error/recovery, context moves, and
  reproduced fail-open on bridge removal.
- **S8:** [Executed native-operation research](opencode-native-operation-experiments.md):
  Code Mode/native result observation, operation correlation, post-create failure,
  interruption, applied moves, and destination capability changes.
