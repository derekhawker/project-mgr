# Proposal: an idea-first workbench for OpenCode

**Status:** reviewed product direction with user-selected decisions; the separate
implementation handoff was approved on 2026-11-07. Release acceptance is pending.
**Date:** 2026-11-07.

**Discussion refinement:** the sections below incorporate the follow-up on UI,
draft conversations, branch safety, repository-independent tickets, and explicit
session context. The user selected Markdown for tickets and one release including
current-workspace migration, single-repository execution, and preservation of
notes collections with optional tickets. The later directory decision gives
both new and existing repo-free workspaces local repositories. Multi-repository execution is deferred to a
second release. Research/isolated experiments are authorized; production changes
and live migration were not authorized by that experiment approval. The later
handoff approval authorizes implementation, not live rollout or provider calls;
explicit migration and preservation requirements remain in scope.

**Integration contract:** [Ticket/session operating contract](ticket-session-protocol-proposal.md)
specifies instruction ownership/invocation, guarded work-record operations,
ticket transitions, native worktree attribution, delegation, and recovery. It
is part of this proposal, not optional implementation detail. The sections here
explain the product; that contract owns the detailed integration rules.

## Recommendation

Make project-mgr the place to **capture, organize, shape, and review work**,
while OpenCode remains the place to discuss and execute it.

Separate four things the current Workspace combines:

1. **Workspace:** an organizational context for related work and repositories.
2. **Ticket:** a durable idea or bounded piece of work, useful before execution.
3. **Run:** an attempt to investigate, implement, or verify selected work.
4. **OpenCode session:** a conversation that can continue across those stages.

Run tracking should normally be automatic bookkeeping, not another form the
user must complete before working.

A ticket should not require a workspace, repository selection, model request,
session, branch, or worktree merely to exist. Execution resources should be
acquired when the selected activity needs them. Existing OpenCode sessions and
worktrees should be attachable, not second-class exceptions.

Ticket storage and lifecycle should be independent of code repositories. Each
ticket conversation needs an explicit, session-scoped binding to that record;
opening an otherwise blank OpenCode session in a checkout is not sufficient.

**The central change is not “bring back Tasks.” It is to stop making a durable
idea depend on a prearranged execution environment.**

Keep the valuable existing foundations: Rust-owned application behavior and
validation, real interactive terminals, exact session associations, safe Git
handling, and OpenCode-owned conversation history. Reconsider eager provisioning,
fixed session roles, and exclusive ownership of worktrees and server processes.

## Why this direction fits the evidence

The reviewed Simgame session began with an existing draft ticket, not a new
workspace. Discussion and source inspection clarified the work. Only after
approval did the agent create a worktree and move the **same conversation** into
it. A testing child was created there and reused through visual refinements.
After human verification, the parent returned to the source checkout, delivered
the changes, and removed the worktree. [A]

That workflow has three strengths:

- The idea survives changes in where, when, and how execution happens.
- Discussion develops the meaning of the work instead of forcing an upfront
  environment decision.
- The human can refine the result in one conversation without repeatedly
  creating another product record.

It also exposed problems a better integration should address: mistaken scope
assumptions, repeated approval friction, worktree-local instruction differences,
limited visibility into child failures, manually copied ticket records, and a
child left pointing at a removed directory. Tickets alone do not solve these.
[A]

This is one detailed case study, not proof that every project wants the same
ticket format, testing arrangement, or Git delivery policy. The proposal adopts
the separation of concerns, not Simgame's entire workflow.

## Where the current product is inflexible

The authoritative current target says **Workspace is the sole regular work
record and a complete unit of work**. It explicitly excludes child work records,
dependencies, and blocker abstractions. The earlier Workspace/Task documentation
is historical, not the current contract. [P1]

| Current choice | Why it gets in the way | Proposed change |
|---|---|---|
| One confirmed prompt creates one Workspace. | A discussion can reveal several ideas, no immediate work, or a correction to an existing ticket. | Capture and relate ideas without forcing a new execution container. |
| Confirmation provisions repositories and starts sessions, even with no starting prompt. | Saving something for later is coupled to Git, model availability, terminal startup, and recovery. | Saving, discussing, and starting work are separate actions. |
| A Workspace has an active/completed lifecycle. | Candidate ideas, readiness, blockers, and human review have no first-class work record beneath an organizational view. | Tickets carry work state; a workspace organizes them. |
| Repository count determines home/worker/orchestrator topology. | One repository can need several specialist agents; several repositories might need only research today. | Agent arrangement follows approved work, not repository count alone. |
| Worktrees belong to Workspaces and are created through the app's managed repository library. | An agent may create or enter a native worktree later; an existing checkout can already be the right context. | Bind validated execution contexts, whether adopted or provisioned. |
| Session restoration trusts an app-recorded directory and checks existence separately. | The same session can move after creation. Review, Docs, and tools can remain bound to an older checkout. | Reconcile OpenCode's current location and Git facts before resume or resource actions. |
| The coordinator queues to a prewritten repository-to-worker manifest. | This is useful dispatch, but not discovery of new children, changing roles, result collection, or a dynamic work graph. | Support native session relationships and optional explicit coordination. |
| Every app session is normally attached to a terminal. | Attaching a terminal to every native child would create clutter and potentially competing control. | Keep the human-facing terminal; inspect or open child sessions on demand. |
| The app owns and stops its OpenCode server. | External CLI work and app work have different runtime ownership assumptions. | Make the connection and process-ownership mode explicit. |

These are design tradeoffs, not evidence that the original choices were
careless. The managed library protects source checkouts, explicit directories
protect instruction scope, and exact worker IDs avoid accidental dispatch. Keep
those guarantees while loosening the product relationships. [P1–P6]

There is also verified contract drift: `Runtime::reconcile_session` requests
500 history messages, while the installed v2.1.4 service rejects that request
with HTTP 400 because its maximum is 200. This is an integration defect found
through a read-only API check, not a reproduced native-GUI failure. It reinforces
the need for maintained, capability-tested contracts rather than relying on old
version notes. No runtime fix is included here. [P4, V1]

## Proposed experience

### Release scope confirmed in discussion

Deliver the ticket/workspace model, Markdown records, conversation context and
status bridge, native single-repository resource tracking, recovery, and migration
as one coherent release. Internal implementation slices are not separate partial
product releases. The release must preserve existing notes/files and useful
conversations, with or without tickets. Workspaces that have no linked repository
receive a local repository under the user-selected directory convention; this
does not require moving their existing notes or creating tickets.

A ticket's active execution context in release one is either one repository
checkout/worktree or a non-repository notes/document directory. A workspace may
retain several repository references and legacy session associations without
starting coordinated multi-repository work. No new cross-repository orchestrator,
worker fan-out, or multi-repository execution run is required until release two.
Existing multi-repository workspaces are excluded from conversion; the user's
later decision is to unlink their management records and clean up their legacy
resources rather than retain a legacy view. Cleanup preserves actual repositories
and `~/OpenCode Projects/Repositories`, as specified below. Migration of eligible
workspaces creates no tickets; zero-ticket
workspaces are a supported state, including existing work and ambiguous cases.

### Capture first

The primary entry action becomes **Capture idea**, not **New Workspace**.

Save a short title and the observation, question, or intended improvement.
Repository, workspace, priority, and links are optional. Saving should work
without a model or network connection. Do not invent requirements, acceptance
checks, or approval to make an early ticket look complete.

Offer **Save** and **Discuss** as distinct actions. Discuss opens a suitable
existing conversation or a new OpenCode session; it does not imply
implementation. A quick-start path can capture and immediately discuss or work,
but should not make an execution environment the price of recording an idea.

This follows the useful part of the existing ticket skill: low-filter capture
preserves uncertainty and does not select an idea for execution. [A, T1]

### Organize before working

Opening a workspace normally shows its **work list**, not an automatically
restored collection of terminals. Provide a global Inbox for unfiled ideas and
an across-workspaces view of active, blocked, and review-ready work.

A compact list should support:

- Manual ordering and a small priority vocabulary.
- Filtering by status, repository, tag, and need for human attention.
- A short outcome/uncertainty preview before opening the full ticket.
- Explicit dependencies where useful; do not infer them from shared files.
- Moving or grouping tickets without creating another copy of the work.

A board can be another view, not a required workflow. Avoid a hierarchy of
epics, milestones, streams, subtasks, and per-agent tasks before evidence calls
for it. The immediate need is to compare candidate work and decide what matters.

Selecting **Work** opens the ticket's active conversation with the terminal
receiving the available space. The backlog need not remain as a permanent
side-by-side panel. Returning to organization does not stop an agent.

### Workspace-centered organization, ticket-centered interaction

Keep a persistent left navigation with Inbox, All work, and named Workspaces,
plus Repositories and Settings. A workspace such as **Simgame** opens its
prioritized ticket list; **Stepped terrain rendering** is a ticket in that list,
not a separate workspace merely because it needs implementation.

Selecting a ticket opens its workbench with Overview, Conversation, and Changes
views. Overview holds the idea, scope, decisions, progress, and verification;
Conversation is the real OpenCode terminal; Changes resolves the relevant
execution checkout. Child-agent activity is available on demand rather than
giving every child a permanent navigation item or terminal.

An existing draft can go directly to **Discuss**. Resume a useful linked
conversation or create a ticket-aware one, without authorizing implementation
or creating an implementation worktree. The ticket remains Draft while its
meaning is explored. Leaving and returning preserves the conversation, and
later implementation can continue in that same session.

### Tools stay available throughout the ticket workbench

**User requirement:** every ticket view supports **Tools**, following the existing
Workspace menu rather than inventing a separate editor integration. Keep the
control in the ticket workbench toolbar across Overview, Conversation, and Changes;
it remains useful for a Draft with no repository, run, or OpenCode session.

Support opening the canonical ticket Markdown in an external editor and showing
its containing folder. Retain the existing terminal, editor/OS handoff, and
repository-script capabilities where their targets exist. Label ticket-document
actions separately from execution-context actions: editing the ticket opens its
independent Markdown, while repository scripts use the verified selected/run
checkout or worktree, and notes work uses its notes context. Directory-scoped
actions must identify their target, not silently inherit another selected ticket
or the parent Workspace's unrelated directory. A missing execution context must
not disable access to the ticket document or provision one just to open Tools.

Reuse the current menu/terminal interaction and Rust-owned target validation.
Frontend commands supply ticket identity and action, not arbitrary paths; Rust
resolves the ticket file and associated context. Tool launches leave existing
conversations intact, and switching ticket views does not stop tool terminals.
The existing `RepositoryToolsMenu`/controller and `os_handoff.rs` are extension
points, not evidence that ticket targeting already works: current OS handoff
accepts a Workspace home, so ticket/file resolution needs an explicit extension.

This extends the [current workbench Tools pattern](ux/screen-workbench.md) and
[OS handoff workflow](application-workflows.md#341-workbench-tools-and-os-handoff).
These current-product documents remain unchanged until the proposal is approved
and implemented; this section records the proposed ticket experience.

### Notes collections are valid workspaces without tickets

A workspace may still be used only for notes/documents and conversations, with
zero tickets and no executing agent. Under the later user-approved directory
convention, a new or existing workspace with no linked repository receives an
ordinary local repository; this supersedes the earlier repo-free Workspace
default without requiring existing notes to move. Notes remain optional: no new
notes folder, notes editor or mandatory notes workflow is required. Preserve
access to existing documents and remember the selected destination rather than
forcing a notes collection through an empty backlog.

Preserve the current document-reader capability and existing files/paths; a new
rich-text editor is not required. The user can open a workspace conversation to
discuss or explicitly organize/edit its notes without manufacturing a ticket.
That conversation has a workspace-context binding and a bounded notes-editing
mode, not a fabricated active ticket or implementation approval.

When the user wants to track an outcome, capture a ticket linked to the notes
workspace. Draft discussion reads the relevant notes; approved document work
uses that notes directory as its execution context. Git branches, worktrees,
commit/merge steps, and code-specific tests do not apply where Git is absent.
The result still has scope, progress, evidence, and human review appropriate to
the work. A ticket can reference selected notes without copying the collection
into its own record or moving the files.

### Discussion does not require an implementation branch

Discussion and authorized source investigation can use a chosen existing
checkout, on whatever branch it already has. That may be `main` or `master`;
the app must not switch branches or change the checkout just to discuss a ticket.
For a ticket without repository context, discussion can begin in a non-repository
context and acquire source context later.

The discussion boundary permits reading code and updating the independent ticket
record, not production-code changes. Implementation starts only after the
required approval and selection or creation of an isolated execution context.
This boundary needs tool/permission support, not only an instruction to the
agent. It does not claim that a working directory alone prevents shell writes.

Repository-backed ticket files would make ordinary grooming dirty the source
checkout, possibly on main. The repository-independent store proposed below
removes that coupling: refining a ticket is not a code-branch operation.

### Shape collaboratively

Ticket discussion should converge on an observable outcome, boundaries,
important choices, and evidence needed for acceptance. It should distinguish:

- What the human has confirmed.
- What the agent recommends.
- What inspection or an experiment established.
- What remains unresolved.

The terrain session's largest misunderstanding was not missing a task record:
the agent conflated a validation fixture with an isolated product change, then
used the wrong elevation concept. Make the intended outcome and material
decisions easy to review; do not treat an elaborate ticket as settled scope. [A]

Discussion can remain in draft, produce several proposed tickets, or return to
an older idea. Do not create or start independent follow-ups without the user's
direction. Ordinary refinements of the same acceptance outcome stay with the
current ticket.

### Start work deliberately, preserve the conversation when useful

When the user chooses to start, resolve the smallest required context:

- Continue discussion or read-only investigation in an existing checkout.
- Create a dedicated worktree when implementation needs isolation.
- Adopt an existing verified worktree.
- Add repository-specific sessions only when cross-repository work needs them.
- Preserve standalone, ungrouped idea discussion without creating a repository;
  explicit creation/migration of a repo-free Workspace uses the local-repo
  convention. Existing non-Git document locations remain accessible.

The default for a useful existing conversation should be **continue it**, with
a real session-location move when needed. A fresh implementation session remains
an option when a clean context or different agent is preferable. Starting afresh
must not be required simply because discussion became implementation.

Before consequential changes, show the selected ticket and approved outcome,
repository/base, intended checkout or worktree, and relevant instruction
differences. This is a start boundary, not another multi-page setup ceremony.

### Review the work, not just whether the agent stopped

Keep ticket progress separate from execution state. A useful default lifecycle
is **Draft → Ready → In progress → Review → Done**, with Blocked and Cancelled
available. Shaping is an activity within Draft, not a mandatory bureaucratic
stage. Project workflows can map their existing states rather than rewriting
every ticket to these exact labels, but mappings must preserve the explicit
[transition and authority rules](ticket-session-protocol-proposal.md#ticket-status-and-session-activity-are-different).
In the proposed default, Ready means human approval for the current bounded
scope, In progress begins with a committed execution claim, Review requires an
explicit evidence-backed request, and Done requires acceptance and delivery.

- A session becoming idle does not complete a ticket.
- When the linked owner session emits `session.idle`, the plugin moves an
  In-progress ticket to Blocked (“Session idle; awaiting continuation”), without
  relying on an agent-written status call. Preserve explicit review/completion
  and other lifecycle decisions; a subagent becoming idle does not block its
  owner's ticket. Resuming approved work clears an idle-derived block, not an
  unrelated explicit blocker.
- A failed child tool does not necessarily block the whole ticket.
- Passing automated checks does not prove visual or native acceptance.
- Human verification can return work to the same run and conversation.
- A missed acceptance condition can reopen the same ticket; genuinely new scope
  can become a linked follow-up. Closing work should not force a new identity
  for every correction.

The review surface should identify changes, validation evidence and limits,
remaining decisions, and the manual verification path. Commit, merge, push,
archive, and cleanup still follow the project's policy. A generic Done action
must not authorize them implicitly.

## Model and ownership boundaries

These are proposed meanings, not changes to the accepted glossary.

| Concept | Durable meaning | Must not imply |
|---|---|---|
| Workspace | A context or collection for organizing related tickets and repository references. | A branch, a checkout, an executing agent, or completion of all its tickets. |
| Ticket | An idea or independently meaningful outcome, with evolving scope and progress. | A session, prompt, or required worktree. |
| Run | A selected episode of investigation, implementation, or verification. | A new ticket or replacement conversation. |
| Session | An OpenCode-owned conversation; may be linked to several tickets or runs over time. | Ownership by one immutable directory or responsibility for all linked work. |
| Execution context | A verified repository checkout/worktree or non-Git directory used by a run. | Authority over ticket scope or permission to remove user files. |

Do not promote every subagent into a ticket. A testing child and its parent can
serve one ticket. Conversely, one planning conversation can discuss many tickets.
Associations should record role and relevant boundaries rather than assuming
the entire conversation belongs to its latest ticket.

Suggested ownership:

- **Ticket store:** intent, decisions, approved scope, dependencies, and work
  status. Project-mgr and agent tools use the same authority.
- **Project-mgr/Rust:** organization, rankings, validated associations, application
  operations, recovery, and owned-process bookkeeping.
- **OpenCode:** conversations, session hierarchy and location, agent execution,
  permissions, and its native worktree facilities.
- **Git/filesystem:** actual repository identity, branch, worktree existence,
  and cleanliness.
- **Human/project policy:** consequential approval and delivery rules.

When these disagree, show the discrepancy and reconcile it. Do not quietly
rewrite a ticket from a session title, move a checkout to fit an app record, or
trust an agent's claimed directory over actual session and Git facts.

## Ticket authority: keep one work record

**Recommend a project-mgr-owned ticket store, independent of code repositories
and branches**, accessible through the GUI and shared agent/CLI tools. Access
should not require the GUI window to be open. This revises the original
recommendation to index repository-backed Markdown as the default authority.

**User-selected format: Markdown.** Canonical ticket content, decisions, scope,
and lifecycle belong in Markdown records in an independent ticket home. This is
not an unresolved database-versus-Markdown choice.

**Problem:** a ticket inside a code checkout acquires that checkout's branch,
copying, merge, and cleanup concerns. The audited session copied a draft into a
worktree and preserved the original elsewhere during delivery. Draft grooming
can dirty main, different trees can disagree about status, and removing an
execution tree can remove the agent's apparent work record. [A]

**Solution:** make repository context an association, not a storage location.
A ticket can have no repository yet, involve several repositories, move between
workspaces, and survive every execution worktree being removed. It links to
repositories, OpenCode conversations, runs, branches/worktrees, commits, and
verification evidence without living in any one of them.

- Stable ticket identity survives naming, grouping, repository, and run changes.
- The GUI and agents read and update the same authoritative record, including
  scope, decisions, approval, status, and dependencies.
- Updates must detect conflicting revisions rather than silently overwrite a
  human's or another agent's changes. Cached context is not another authority.
- Do not copy the live ticket into each execution worktree or maintain a second
  independent active-ticket status index.
- Keep `AGENTS.md`, project-specific skills, and living project/architecture
  documentation in their repositories. Those describe how the project works;
  tickets describe work being considered or undertaken.

**User-approved storage boundary:** retain SQLite for
workspace organization/settings, session and run bindings, resource-operation
journals, verified human-action receipts, migration state, and recovery metadata.
These are durable operational records, not a second editable ticket body or
lifecycle. Search/display indexes of ticket fields are derived and rebuildable.
Existing notes/resources remain ordinary files in their existing homes, and
conversation history remains exclusively in OpenCode.

Use one configurable ticket home outside code repositories, split into Workspace
subdirectories. Ungrouped ideas use an unassigned area, preserving capture
without a Workspace. For example:

```text
<ticket home>/workspaces/<workspace-id>/<ticket-id>.md
<ticket home>/unassigned/<ticket-id>.md
```

Ticket and Workspace IDs are stable; display-name changes do not break links or
require a new identity. Reorganizing a ticket changes its grouping/path through
the Rust store, not its session identity or execution directory. Back up Markdown
and operational metadata coherently. Recovery material is required; a dedicated
revision-history UI is not required for this release. Ticket-home storage is not
a return to per-Workspace project/code folders under `~/OpenCode Projects/`.

Markdown replacement and SQLite commit are not a single atomic transaction.
The selected runtime must detect conflicting revisions, journal pending updates,
recover interrupted writes, and define a coordinated backup/restore boundary.
An externally edited status can describe the ticket, but cannot fabricate a
verified execution approval receipt. The
[runtime/storage experiments](ticket-runtime-storage-experiments.md) test these
constraints before architecture conclusions are accepted.

Ticket Tools can open the canonical Markdown. App and plugin writes share the Rust core. A SQLite-only backup is insufficient; combined backup remains a separate review concern.

Existing repository tickets need an explicit import or external-link policy,
not silent relocation. Imported/exported copies must not become competing
authorities. Retaining a deliberately external repo-backed workflow can be a
compatibility option, but should not dictate the new default. Resolve existing
duplicates explicitly and avoid a general bidirectional synchronization engine.

Ticket content is an intentionally authored product record, not permission to
persist original or starting prompts. Existing prompt-transience and secret-free
logging requirements stay in force. Do not store transcripts in ticket caches.

## Integrate with native OpenCode behavior

### A required bridge, not a reporting convention

The session audit's worktree was created because a repository reference required
it before implementation. That is a normal supported path, not an exception the
user must mirror with an app button. Project-mgr must observe the operation even
if the agent never explicitly reports it.

The [operating contract](ticket-session-protocol-proposal.md) therefore requires
three cooperating mechanisms:

| Mechanism | Invocation | Responsibility |
|---|---|---|
| Session bootstrap, ticket router, and phase/project references | Before ticket work, at the named activity branch, and on resume/mode/context change. | Tell the agent which record and rules apply, including when to checkpoint and seek human decisions. |
| Guarded Rust work-record tools and verified human actions | Every ticket mutation, execution claim, approval, review, and delivery transition. | Persist one lifecycle truth with role/revision/approval checks; usable from the OpenCode terminal without duplicate GUI status edits. |
| Runtime observation and reconciliation | Native tool operations, session/child/worktree events, reconnect and live-state checks. | Discover actual resource/activity changes, verify attribution, and expose omissions or uncertain state without relying on prose. |

Managed ticket sessions require all three. Observed external sessions are labeled
as such and cannot promise the same guards or lifecycle reporting. A special
planning agent remains optional; the integration bridge does not.

The user requires a working plugin as part of the integration; protection against
deliberate plugin removal is not a release requirement. Treat a missing plugin
as an integration fault with a repair/reconciliation path, not a reason to build
an OpenCode host-level enforcement system. The experiment's limitation remains
true: OpenCode can continue after the plugin is removed. Do not describe that
case as guarded. Persistent session-to-ticket links survive plugin absence;
refreshing current ticket context and observing new operations require it active.
See the [readiness assessment](idea-first-implementation-readiness.md#overall-readiness-and-important-decisions).

Native call observation must cover calls inside Code Mode `execute`, not only
direct top-level tools. Pinned v2.1.4 source establishes that public tool hooks
and retained-executor transforms reach those calls. The recommended wrapper
records intent and result with its own operation ID: inner Code Mode calls share
the outer call ID, so that ID alone cannot safely correlate concurrent results.
The [native-operation experiment](opencode-native-operation-experiments.md)
verified the actual installed path and failure cases; the
[context experiment](opencode-session-context-experiments.md) verified native
child binding and exposed a plugin-removal failure. Production authority,
packaging, and reload guarantees still need acceptance. Where the required
interception is unavailable, guarded bridge-owned context tools calling the native
API may provide a documented degraded or recovery path, or an OpenCode change
may be required. Such a fallback cannot substitute for required native release
acceptance; the profile must not silently miss operations and call the session
managed. See the
[worktree protocol](ticket-session-protocol-proposal.md#native-worktree-tracking-protocol)
and [focused hook research](opencode-tool-observation-research.md).

### Give every ticket session an explicit context bridge

**Problem:** a blank session in a checkout can discover code and repository
instructions, but cannot reliably know where independent tickets live, which
ticket it is handling, what has been approved, or how to maintain that record.
Repository independence makes this missing context more important, not less.

**Solution:** supply two complementary kinds of context before the first
ticket-related model turn:

| Context | Source | Contents |
|---|---|---|
| Project context | Verified checkout and OpenCode's normal discovery | Code, living documentation, repository/global instructions, and project-specific skills. |
| Work context | Explicit project-mgr session binding | Stable ticket ID/title, authoritative store reference and access method, current scope/decisions/approval/next action, activity mode, associated repositories, and current execution context. |

The user should not have to paste this setup into every conversation. The bridge
installs a session-scoped bootstrap and explicitly attaches the proposed
`project-mgr-ticket` entry skill. Its capture/shape/execute/review/recovery
references each have named invocation conditions and committed completion
criteria. Repository `AGENTS.md` retains project policy, not the active ticket or
another lifecycle database. The
[instruction inventory and router table](ticket-session-protocol-proposal.md#instruction-ownership-and-invocation)
specify which guidance is always present, explicitly loaded, or enforced by code.

A compact injected binding provides orientation; the live ticket tools provide
current truth. A one-time pasted ticket becomes stale and cannot support reliable
updates. A global skill explains the workflow but does not supply the actual
ticket association, storage access, or executable tools. Both are needed. If
binding or required access fails, show a recoverable error before ticket-related
generation rather than presenting an unconfigured session as ready.

**The active ticket is session-scoped, not the globally selected GUI row.**
Navigating to another ticket must not redirect an existing or background agent.
One session may discuss several tickets over its lifetime, but changing its
active work binding is explicit and reconciles any in-flight work. Merely
linking an additional ticket does not replace the active one.

- On resume, refresh the ticket revision, approval, mode, and next action before
  continuing; do not trust an old injected snapshot.
- On a worktree/session move, preserve the ticket binding while revalidating
  project context and execution location. The ticket remains in its own store.
- On delegation, give the child the ticket reference, assigned scope and role,
  applicable approval boundary, access to required ticket operations, and its
  independently verified execution context. Do not assume the parent's entire
  conversation or future context changes automatically propagate.
- Treat discussion-to-implementation as an explicit change of authorization and
  execution context, not an automatic consequence of talking about code.

This bridge is a prerequisite for ticket-aware conversations, not an optional
enhancement after adding a backlog UI. The
[logical tool contracts](ticket-session-protocol-proposal.md#bridge-operations-and-execution-authority)
and [human-action rules](ticket-session-protocol-proposal.md#human-decisions-inside-the-opencode-conversation)
are specified now. Wire schemas, process transport, and implementation layout
remain later work; those choices must preserve the proposed semantics.

### Adopt sessions and reconcile moves

Support **Attach existing session**, including the session studied here. Read
its service identity, current location, parent/child relationships, and selected
ticket associations. Read history from OpenCode on demand; do not import a copy
of it into project-mgr.

A session location is mutable. Preserve location history or association changes
needed for recovery, but consult current OpenCode state before resuming, opening
tools, or choosing a change-review checkout. Validate any newly observed
directory before adopting it as an executable or cleanup target.

Treat events as refresh signals, not the only recoverable truth. The audited
children's experimental logs returned sequence watermarks without historical
events; the pinned source makes payload retention optional and off by default.
Recovery must work from current session, Git, ticket, and pending-input state,
even when replay is unavailable. [O]

Do not automatically follow every parent move with its children. Some children
may intentionally remain in an earlier context. Show each effective directory.
If a child's worktree no longer exists, retain its history and offer an explicit
new-location or new-session recovery path; do not automatically recreate the
tree or discard the conversation. [A, O]

### One provisioning decision, not two competing worktree managers

Prefer native OpenCode worktree facilities when their validated contract fits
the selected project policy. Rust can orchestrate those calls and record the
result without implementing a competing resource lifecycle. The previous
managed-clone/library option is being reconsidered, not assumed necessary; see
the directory-model review below.

Whether a tree is created through the app, agent tools, or outside CLI work,
track repository identity, actual path, branch/base facts, origin of the
resource, and cleanup authority. The app and agent must not independently
provision a second tree for the same start request. Detect and reconcile
out-of-band changes; directory names alone do not establish ownership.

Before a managed native effect, persist an operation tied to the runtime session,
run, and tool call; afterward validate the actual returned context and Git facts.
`worktree.updated` is a project-level invalidation, not a ticket/session receipt.
Re-list inventory for discovery; use call provenance or verified session usage
for attribution. Shell-created or ambiguous trees stay discovered/unassigned
until evidence or human confirmation resolves them. Record pending/uncertain
effects before retrying rather than blindly creating a second tree. The
[normal sequence and attribution matrix](ticket-session-protocol-proposal.md#native-worktree-tracking-protocol)
cover events, shell Git, partial failure, concurrent creators, and removal.

Adopting an external tree grants no automatic right to remove it. Completion,
untracking, stopping execution, and deleting a worktree are separate actions.
Check running descendants and processes as well as Git state before cleanup;
the historical existence of an idle child is not itself a perpetual cleanup
lock. Worktrees provide Git isolation, not a security sandbox.

### OpenCode Projects directory and repository locations

**Updated directory direction:** a Workspace is an organizational record, not a
mandatory folder under `~/OpenCode Projects/`. Use an existing shared repository
checkout when linked; for a new or existing workspace with no linked repository, create an
ordinary local repository using the convention below. OpenCode manages execution
worktrees. No separate managed base clone, Workspace repository mirror, `repos/`
symlink, or automatic `notes/` folder is needed.

Keep these locations separate:

| Location | Proposed responsibility |
|---|---|
| Legacy project home, normally `~/OpenCode Projects/` | Retain the root and its `Repositories/` subtree. Remove only obsolete Workspace artifacts and obsolete symlink aliases, preserving actual repositories and retained user files. No new per-Workspace wrapper folders are required here. |
| Configured repositories directory | Keep `~/OpenCode Projects/Repositories` and reuse the configured repository root. It stores actual checkouts; it is not a disposable cache or a required extra clone layer. |
| Existing shared source checkout | Repository context registered where it already lives. It may be used for discussion and as the source for native worktree creation. Do not move it, reset it, or switch its current branch automatically to make it “main.” |
| Execution worktree | Created/listed/removed through OpenCode's native worktree facilities, subject to safe cleanup. Track the actual returned canonical path rather than inventing a parallel app directory or alias. |
| Ticket Markdown home | Independent of code checkouts and execution worktrees; deleting a worktree cannot delete the ticket. Workspace conversations do not require any ticket. |

**User-approved defaults:** reuse the configured repositories directory and the
local username as its organization-like namespace; present the informative
repository name for editing before creation. Changing a display name later does
not automatically rename a repository. Legacy cleanup preserves that root and
the repositories already stored there.

For **new workspaces using an existing repository**, associate the chosen
checkout without creating another clone, Workspace branch, worktree or symlink.
A worktree is acquired when selected work needs one. Discussion/source access
and isolated implementation remain distinct.

For **new workspaces without a linked repository**, and **existing repo-free
workspaces during migration**, the user selected a blank local repository at:

```text
<repos dir>/<username>/<informative-repo-name>/
# Example: <repos dir>/derekhawker/movie-preferences-manager/
```

The username is the local organization-like namespace; the informative name is
a reviewed filesystem-safe project slug. No hosting account, remote, publish,
push, duplicate base clone, Workspace wrapper directory, or automatic ticket is
required. This directory is the actual project checkout and is registered as
such. A standalone captured idea/ticket still does not create a repository;
local initialization belongs to explicit Workspace creation or the approved
repo-free Workspace migration, not every captured idea.

Recommended bootstrap: initialize `main` and create one empty initial commit,
leaving zero project files. An isolated Git check confirmed that worktree
creation fails on the unborn branch and succeeds after that empty commit. Use
the user's configured Git identity; a missing identity needs an actionable
setup error rather than invented author details or global configuration changes.
Rust validates the root, namespace and slug, and never overwrites/adopts a
colliding existing directory without an explicit choice. The username namespace
and Git commit author identity are distinct concepts.

For **eligible existing workspaces**, preserve retained notes/files, actual
checkout/worktree paths, and exact session locations. Resolve stored repository
aliases to their verified canonical targets before retiring the obsolete symlink
layer. Remove the symlink entry only, never its target. Preserve actual managed
checkouts too: their earlier ownership does not make them disposable repositories.
Do not create a ticket, move user files, or retarget a running session merely to
retire layout aliases. Remove only proven obsolete artifacts; defer ambiguous
user content and anything still required by an active session/tool process.
Multi-repository workspaces are excluded from conversion; their management
records/resources follow the separately scoped unlink-and-cleanup policy below.
Existing repo-free workspaces receive a new local repository under the same
convention. Link it as the Workspace's repository context for future sessions;
preserve old files/document roots and exact existing session locations. Creating
that repository is not authorization to initialize Git inside an old notes
directory, move user files, retarget a live session, or delete its old home.
Any actual session move uses the existing explicit safe-move protocol.

This migration now has a filesystem creation step: journal the intended path and
ownership before creation, recover partial initialization/first-commit failure,
and reuse a verified completed result on retry. A colliding user-owned directory
must not be overwritten, adopted by guess, or removed as cleanup. Do not create
a second local repository because a successful first creation lost its receipt.

Read the [current directory layout](application-workflows.md#32-user-project-home)
and [current repository invariants](workspace-refactor-target.md#repository-and-session-invariants)
for the design being replaced. The [native worktree research](opencode-workflow-integration-research.md#6-worktree-inventory-creation-removal-and-events)
explains OpenCode's source/configuration root and destination rules: destinations
come from OpenCode's configuration/strategy and are not necessarily under
`~/OpenCode Projects/`. Repository defaults and the independent ticket-home model
are selected; concrete migration/cleanup mechanics still need implementation
and validation. No directory or configuration changes are executed by this proposal.

### Make instruction provenance inspectable

An on-demand context inspector should distinguish:

1. The OpenCode session's effective location.
2. A tool's explicit working-directory override.
3. The verified Git root and branch.
4. Repository/global instruction sources and relevant revisions, when available.
5. Discovered skills versus skills actually activated.

Do not label a read of `AGENTS.md` as proof of automatic injection, or label
injection as proof of compliance. Show Unknown where OpenCode does not expose
enough evidence. The source-checkout versus worktree instruction difference
seen in this session is exactly the discrepancy users need to understand. [A]

Never silently copy a dirty `AGENTS.md`, local plugin, credentials, or untracked
configuration into a new worktree. Disclose relevant differences and let project
policy choose committed guidance or an explicit, auditable alternative.

### Keep native subagents; add a narrow bridge where needed

For work in one repository, native parent/child delegation should be the default.
The testing-child workflow already demonstrates its usefulness. No special
project-mgr orchestrator is required merely because a ticket has multiple steps.

For release-two cross-repository execution, a parent outside repositories cannot assume
that its children have each repository's instructions. Create repo-rooted
workers with the correct location **before their first prompt**, or use a native
explicit-location child capability if the installed contract supports it.
Telling a child to inspect an absolute path is not a substitute. [O]

The required ticket bridge supplies record/context operations and observation.
An optional project-mgr orchestration profile can plan and dispatch bounded work
using those capabilities; it reuses OpenCode sessions and delegation rather than
creating a parallel agent runtime. A worker receives an explicit assignment and
may report evidence, but the designated owner controls lifecycle. Native child
metadata inheritance alone is neither a verified assignment nor write authority.

The current coordinator's “prompt admitted” result is honestly limited, but
admission is not completion. A future coordinator must distinguish queued,
running, failed, waiting, and finished work and collect evidence before claiming
integration is complete. Scope authority and destructive operations need real
tool validation; prompt instructions alone cannot enforce them. Unrestricted
shell operations remain an out-of-band capability unless explicitly restricted.

Child activity should be visible on demand, including effective directory,
role, significant failures, and pending input. Do not attach another terminal
to every child automatically or replace the native conversation with a custom
transcript UI.

### Treat service ownership as a product choice

**User decision: use OpenCode's shared service**, the same service used by the
CLI. Project-mgr is a client, not the lifecycle owner of that service. Quitting
project-mgr detaches its presentation and leaves ongoing OpenCode work running;
reopening reconnects to the same sessions. A private app-owned mode is not a
required additional feature of this release.

For project-mgr's own authority, the executed runtime prototype supports a
shared Rust core plus a one-shot JSON-stdio adapter called by the OpenCode-side
bridge, while Tauri calls the core in process. No new project-mgr daemon is
needed just to keep tickets and operation receipts accessible when the GUI is
closed. The shared OpenCode service hosts the plugin independently of the GUI;
the ticket command transport does not introduce another background server.

This explicitly replaces the current app-owned-server direction in the proposed
release. It is a user-approved lifecycle change to implement, not a configuration
tweak already made to the running application. [P6]

The app should attach to a selected authenticated service, retain that
connection identity with session associations, and negotiate required
capabilities. Do not assume two server processes expose the same active jobs
merely because stored session IDs are visible. If external live sessions cannot
be controlled through the selected connection, say so and offer a supported
handoff rather than spawning a competing owner.

Closing a view or quitting project-mgr must not interrupt shared-service agent
execution, cancel its subagents, or stop the service. The plugin continues ticket
updates while the app is closed. Reopening restores associations and current
activity without sending duplicate starting prompts or creating replacement
conversations. Stopping OpenCode work remains an explicit action, not a side
effect of app shutdown. App-owned shell/tool terminals have separate process
ownership and are not promised background persistence by this decision.

Upgrade from the existing app-owned runtime needs a safe ownership transition;
do not stop a live server or duplicate its work during planning or migration.
Validate close/quit/reopen through the native application with actual ongoing
OpenCode execution and subagents, not only saved session visibility. This has
not yet been implemented or validated by the isolated feasibility experiments.

## Global skills and possible OpenCode improvements

The generic `gated-implementation` skill is **already globally available**. It
deliberately leaves record format, Git, delegation, and delivery policy to the
project, but currently expects a durable file. Adapt its record access to the
bound tool-addressed ticket before reusing its execution process here; do not
pretend it works unchanged or generate a competing file plan. [T2]

Extract the reusable parts of local `ticket-management` into a global skill:
capture uncertainty, find duplicates, shape a selected idea, maintain scope and
evidence, and resume from the durable record. Keep gameplay-value judgments,
Simgame paths/statuses, mandatory testing delegation, and squash-to-main rules
in a local policy adapter. Global availability must not mean global enforcement
of Simgame's workflow. Loading a skill also does not create an app association;
an explicit tool or record link must do that.

Use a namespaced global `project-mgr-ticket` router and a narrow worker brief,
not an ambiguous global replacement for every repository's `ticket-management`.
Explicitly activate the entry for managed sessions; model discovery is only a
fallback. Local references that require `_tickets/` or active-index updates need
an agreed adapter before adoption, while their substantive testing/delivery
rules remain local. The [instruction inventory](ticket-session-protocol-proposal.md#instruction-ownership-and-invocation)
is the single specification of invocation, ownership, and phase references.

Worth proposing upstream to OpenCode, subject to the installed contract:

- Explicit location selection for native child creation, applied before its
  first model turn and reported back with the child ID.
- A session context/provenance view that makes initial and changed instruction
  sources inspectable, including children.
- Clear reporting of delegation depth/capability limits before an agent designs
  an unavailable hierarchy.
- Worktree/session usage information and an explicit recovery experience when
  a retained session points at a removed tree.
- Reliable capability and event contracts for consumers observing session moves,
  child creation, pending input, and worktree changes.

These are product/integration requests, not claims that every item is absent
from every OpenCode version. The technical appendix records what is documented,
experimental, source-supported, or still uncertain. [O]

## Alternatives considered

| Direction | Benefits | Costs and limits | Assessment |
|---|---|---|---|
| **Add backlog fields to today's Workspace** | Smallest conceptual change; retains existing provisioning and screens. | Leaves idea, execution, and resource lifecycle coupled; external sessions and dynamic children remain awkward. | Useful only as an interim convenience, not the recommended destination. |
| **Idea-first workbench with native execution** | Supports capture, prioritization, existing CLI work, continuing conversations, and project-specific workflows. | Requires explicit ticket authority, mutable session-context reconciliation, and new ownership rules. | **Recommended.** Changes the right boundaries without replacing OpenCode. |
| **A bespoke project-mgr orchestrator harness** | Could tightly manage approval, scheduling, cross-repo execution, and evidence. | Risks a second agent runtime, brittle plugin coupling, competing histories, and forcing every project through one process. | Keep a narrow optional orchestration profile; do not make the whole product depend on this first. |

## Directional acceptance scenarios

These are ways to judge the direction, not an implementation test plan:

1. Capture and rank ten ideas without starting OpenCode or creating Git resources.
2. Discuss two ideas, defer one, and start only the selected ticket.
3. Attach the existing terrain session and show its real child relationships,
   moves, and removed execution location without duplicating its history.
4. Continue a useful discussion into implementation in a new worktree without
   replacing the parent conversation; disclose differing project guidance.
5. Observe an agent-created worktree without provisioning a duplicate or
   claiming cleanup authority over an external resource.
6. Exclude existing multi-repository workspaces from conversion; unlink their
   project-mgr records and clean up only the inventoried/approved legacy targets.
   New coordinated work remains a release-two scenario. Native OpenCode history
   is not deleted merely by unlinking project-mgr associations.
7. Distinguish automated success, human review, a failed child operation, and
   delivery completion. A green session status cannot silently mark the ticket Done.
8. Resume after a missing worktree, service disconnect, or externally edited
    ticket without losing the record or silently overwriting user work.
9. Open a draft directly into discussion with the right ticket, mode, approval,
   and store access already supplied. Refine it without changing source code,
   switching branches, or dirtying the source checkout with ticket metadata.
10. Navigate between tickets while another session runs without changing that
    session's active ticket. Resume, move, and delegate without losing the binding
    or relying on stale approval; removing an execution tree retains the ticket.
11. Give a formerly repo-free workspace its local repository while preserving its
    existing notes and conversations; keep zero-ticket use valid. New repo-free
    Workspace creation uses the same local-only convention. Neither path creates
    a wrapper/notes directory, remote or ticket; retry creates no duplicate repo.
12. Migrate eligible zero/single-repository workspace/session/resource associations
    with zero tickets, without losing files/history or assigning invented scope
    approval. Excluded multi-repository cleanup follows its explicit target list.

These product scenarios are complemented by the required
[integration acceptance gates](ticket-session-protocol-proposal.md#acceptance-gates-before-claiming-this-protocol-works):
reference-triggered Code Mode provisioning, concurrent attribution, same-terminal
status transitions, missing checkpoints, child permissions, and recovery after
partial effects or lost observations.

## Single-release migration and retained scope

The release must migrate eligible zero/single-repository regular workspaces to
organizational workspaces while preserving identity, home paths, notes/resources, tags,
repository/context associations, exact OpenCode session IDs, and retained
lifecycle history. Files, branches, worktrees, and OpenCode conversations stay
where they are; migration must not start agents, merge code, or remove resources.
For workspaces whose original repository count is zero, create/link the local
repository described above. This does not relocate their pre-existing resources.

**User decision: migration creates no tickets.** Existing repository work,
unfinished document work, notes collections, and ambiguous workspaces all remain
valid with zero tickets and their existing conversations/contexts. There is no
classification interview or seed-ticket step. Tickets are created later only
when explicitly requested, not to fit old work into the new model.

Imported active/completed state must retain its legacy provenance. It is not
proof of reviewed scope, human verification, or permission for a managed agent
to continue. Do not infer approval from the newest conversation or run another
model to manufacture ticket requirements from prompts. Preserve existing
workspace-level history and context without inventing ticket scope or requiring
a ticket merely to restore its conversation.

**Existing multi-repository workspaces are not converted or retained in a legacy
view.** The user selected unlinking their project-mgr database records and cleaning
up obsolete Workspace artifacts. The user subsequently confirmed preserving all
actual repositories and `~/OpenCode Projects/Repositories`; do not delete the
whole `~/OpenCode Projects/` root. This supersedes both the earlier leave-intact
recommendation and the tentative whole-root deletion option. Native OpenCode
conversations remain OpenCode-owned; unlinking an application association is not
a request to recursively delete session history. New coordinated multi-repository
execution remains deferred.

**User-confirmed cleanup boundary:** remove obsolete Workspace artifacts and
symlink aliases, while retaining actual repositories/checkouts, Git metadata,
and `~/OpenCode Projects/Repositories`. This includes this task's active worktree,
common Git repository, local research branches and uncommitted proposal documents.
Actual repositories outside `Repositories/` are protected too; a parent directory
is not disposable merely because it was once a Workspace home.

Before cleanup, build an exact ownership/retention manifest from management and
filesystem/Git facts, keep verified backups outside cleanup targets, and resolve
active usage. Update retained repository references to verified canonical paths
before removing their old aliases. Unlink symlinks themselves without following
their targets; never recursively delete a parent containing a retained repository.
Preserve native OpenCode history when unlinking project-mgr records. Cleanup
intent/result records must survive removal of the old owner records so a partial
failure can resume safely. Ambiguous user files are not automatically artifacts.
This is a migration acceptance boundary, not live cleanup during planning. No
database unlink or filesystem deletion has run.

The migration must be restartable across filesystem and SQLite changes, use
deterministic workspace/context mappings, retain a verified pre-upgrade backup/snapshot, avoid overwriting
user-created ticket files, and detect partial results before retrying. Historical
legacy Task snapshots remain preserved; they are not silently resurrected as
current work. A complete migration manifest, recovery procedure, and historical
fixture coverage are required before touching live data. This document updates
the required direction; no migration is executed by the research work.

**User decision: keep Quick Requests unchanged for this release.** They organize
one-off/random OpenCode asks; do not convert them into tickets or require the
ticket approval/execution workflow. Preserve their existing lifecycle, native
conversations and original-prompt storage exception. They use the selected shared
OpenCode service, like other app-launched conversations.

Do not expand the first direction into unattended scheduling, automatic ticket
decomposition, a general tracker-sync engine, a new conversation renderer, or
mandatory autonomous agents. User-controlled selection and reliable visibility
come first.

The current-product contracts, UX glossary, screen specifications, runtime rules,
and integration matrix still describe the existing application. Update them
alongside the approved implementation that changes each behavior; this proposal
does not claim those changes have shipped.

## Decisions to review

1. **Product shape:** Workspace is organizational context, Ticket is the work
   record, and Run is the execution episode. Capture does not require a Workspace;
   a Workspace may have zero tickets.
2. **Ticket authority:** canonical Markdown lives in one configurable independent
   ticket home, grouped by Workspace with an unassigned area. SQLite stores
   operational metadata; backup covers both. No dedicated revision-history UI is
   required. Ticket Tools can open canonical Markdown.
3. **Integration stance — shared service selected:** use the same OpenCode service
   as the CLI; quitting project-mgr leaves agent work and the plugin running.
   Reopening reconnects to the same sessions. No extra private mode is required.
4. **Orchestration:** native subagent delegation remains the default. The required
   plugin observes operations and connects the work record; an additional
   project-mgr orchestrator is not required for single-repository work.
5. **Session context:** persist exact Workspace/ticket associations, supply live
   ticket tools and current activity/approval context, and preserve identity across
   resume/move/delegation. Workspace conversations do not need a fabricated ticket.
6. **Operating protocol — forms selected:** approval of the agreed complete plan
   and acceptance/requested changes to the reviewed result use explicit OpenCode
   session forms in the terminal, with Rust-recorded revision-bound decisions.
   No repeated approval between tasks. The required plugin observes native
   operations and applies the owner-idle Blocked fallback independently of prose.

The single-release scope, preservation of notes/conversations, and local-repo
creation for new and existing repo-free workspaces are user decisions, not open
staging questions. Zero tickets remains a supported state.
Ticket storage, directory defaults, Quick Request treatment, structured human
decisions, and shared-service direction are selected. Migration creates no
tickets; excluded multi-repository workspaces are unlinked/cleaned up rather
than converted; cleanup removes obsolete Workspace artifacts/aliases while keeping
actual repositories and `~/OpenCode Projects/Repositories`. No material product
decision is currently queued; implementation details and validation remain.
Read the
[implementation-readiness assessment](idea-first-implementation-readiness.md)
for hypothesis/experiment conclusions and remaining constraints.

These reviewed decisions are inputs to the separate
[task-based implementation-plan handoff](idea-first-implementation-plan.md),
approved in full on 2026-11-07. Approval does not authorize live
migration/cleanup, external-provider calls, global skill installation, live
service-lifecycle changes, or changes to Simgame's working conventions now.

## Sources and validation limits

- **A:** [Detailed session audit](idea-first-session-audit.md), with exact
  session/message references, directory findings, child behavior, and limitations.
- **O:** [OpenCode integration contract research](opencode-workflow-integration-research.md).
- **I:** [Proposed ticket/session operating contract](ticket-session-protocol-proposal.md).
- **O2:** [Native tool observation research](opencode-tool-observation-research.md).
- **E1:** [Runtime/storage experiments](ticket-runtime-storage-experiments.md).
- **E2:** [Installed native-operation experiments](opencode-native-operation-experiments.md).
- **E3:** [Installed session-context experiments](opencode-session-context-experiments.md).
- **P1:** [Accepted Workspace-only target](workspace-refactor-target.md), especially
  product model, creation, session invariants, compatibility, and deferred work.
- **P2:** [New work specification](ux/screen-new-work.md) and
  [workbench specification](ux/screen-workbench.md).
- **P3:** `app/src-tauri/src/lib.rs:1880–2257`: provisioning, generated
  instructions, eager session startup, and persisted role assignment.
- **P4:** `app/src-tauri/src/session_restore.rs:23–44`,
  `management.rs:4230–4353`, and `opencode.rs:381–410,576–605`: exact stored-path
  restoration, context checks, existence lookup, and reconciliation.
- **P5:** `app/src-tauri/src/workspace_coordinator.rs:25–94,104–148,187–237`
  and `app/src-tauri/plugins/workspace-coordinator/{index.ts,coordinator.mjs}`:
  fixed validated worker associations and queue-admission-only tool behavior.
- **P6:** `app/src-tauri/src/opencode.rs:296–361` and
  [existing v2 contract](opencode-v2-contract.md), especially process ownership.
- **T1:** Simgame `.agents/skills/ticket-management/SKILL.md` and
  `references/{capture,ticket-format,repository-workflow,execution,closeout}.md`.
- **T2:** `~/.agents/skills/gated-implementation/SKILL.md`, especially record
  authority, scope approval, local policy, and delivery boundaries.
- **V1:** Installed `opencode --version` and read-only `GET /api/info` both
  reported v2.1.4. Read-only
  `GET /api/session/ses_e4bae403effeE89cEIZx2ded4L/message?order=asc&limit=500`
  returned HTTP 400 with a maximum-of-200 validation error on the research date.

This is a session/API/source/specification review supplemented by independently
rerun isolated experiments and two existing production preservation/reader tests.
Private fixtures exercised installed native execution with synthetic loopback
providers; they did not use external providers or live user sessions. No product
behavior, global user configuration, service ownership, or user data was changed.
Native project-mgr GUI/Wayland, full production authority integration, the new
migration, packaging, and external-provider acceptance remain unvalidated.
Existing documentation contains transitional inconsistencies; the accepted
target and inspected code, not historical Task flows, ground the current-product
critique. The new proposal remains distinct from that accepted contract.
