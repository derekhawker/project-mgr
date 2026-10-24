# Workspace-Only Product Contract

This is the accepted target contract for the Workspace refactor. It supersedes
the current Workspace/Task behavior described in `application-workflows.md` and
the existing New-work and workbench UX specifications until those documents
are rewritten to match this contract. The refactor plan tracks delivery order.

## Product model

- Workspace is the sole regular work record and the unit that progresses from
  creation through completion. It may describe a bug, an end-to-end effort, or
  substantial file-based work; repositories are optional.
- A new original prompt creates exactly one Workspace after the user confirms
  an editable proposal. The model does not create child work records, split the
  request, or automatically relate other Workspaces.
- Workspace tags are labels for grouping only. They do not sequence work,
  represent dependencies, or own lifecycle. Dependencies and blockers are not
  part of this refactor.
- Quick Request remains the existing special one-off tracked workflow for
  simple file requests, with its own distinct product record and lifecycle. It
  is not represented as a Task or a second way to split regular Workspace work.
- OpenCode owns conversations. The app stores session IDs, Workspace/repository
  associations, working directories, lifecycle, and resource/setup state, but
  never a duplicate transcript. Prompts remain transient inputs, other than the
  existing Quick Request original-prompt exception.
- Review, commit, and merge decisions come from the repository's own
  instructions and skills; the app does not impose a new end-of-work workflow.

## New Workspace proposal and confirmation

1. The user enters an original prompt and chooses a model. The prompt is sent to
   a transient proposal interaction with the app's enabled repository catalog
   as context. No Workspace, worktree, or regular session exists yet.
2. The proposal supplies Workspace name/description, selected repository IDs
   and rationale, and an optional starting prompt. Rust validates the proposal
   and repository identities. The user can edit details, repository selection,
   branch/worktree setup, and starting prompt before confirmation.
3. Confirmation creates one Workspace, provisions the approved work contexts,
   and starts every required session. A blank starting prompt does not skip
   session startup. Any prompt submission occurs only after the matching
   interactive session is attached and ready.
4. Cancellation before confirmation creates no Workspace and has no Git side
   effects. A failure after durable creation leaves one recoverable Workspace;
   retry resumes its recorded setup rather than creating another Workspace or
   duplicate resources. Prompt text is not written to application logs.

| Approved repositories | Work contexts and sessions |
|---|---|
| None | Workspace home directory; one OpenCode session rooted there. |
| One | One approved branch/worktree; one repo-rooted OpenCode worker session. No separate orchestrator. |
| Multiple | Approved branch/worktrees; one Workspace orchestrator session rooted outside repositories, plus one prestarted empty OpenCode worker session rooted in each repo worktree. |

In the terminal bar, label the outside-repository session **Orchestrator** and
label each worker with its repository name. With zero repositories, label the
Workspace-home session **Workspace**. These labels come from the persisted
session role and repository association, not from guessing based on the newest
session or a symlink path.

The single-repository session may receive the confirmed starting prompt when it
is nonblank. The multiple-repository workers start empty: do not fan out the
original or starting prompt. The orchestrator may receive the confirmed starting
prompt, but must start even when it is blank. The orchestrator coordinates
workers through app-provided custom tools, not OpenCode subagents. Each tool
call targets an existing worker session ID and admits a repository-specific
prompt; success need only acknowledge admission and does not promise a completed
answer. The user can open and interact with each worker tab directly. Reporting
worker status, waiting, and result visibility may be designed separately; never
copy conversation messages into app storage.

The app installs a Workspace-local OpenCode plugin only for multi-repository
Workspaces. It starts and records all repo workers first, then writes a
versioned worker-ID manifest and the coordinator plugin under the hidden
`.opencode/plugins/` directory before starting the orchestrator. The plugin
offers a repository-ID selector and queues the supplied prompt to that
repository's exact tracked session ID. These generated files contain association
metadata and plugin code, never prompt contents. Existing files and symlinked
configuration paths are not replaced or followed.

## Repository and session invariants

- Catalog repositories are proposal context, not Workspace bindings, until
  confirmed. Rust—not model output or GUI-supplied paths—validates repository
  IDs, canonical roots, identities, branch choices, and worktree destinations.
- The app owns a configurable repository-library root, separate from the
  source checkouts registered in Directories. Its default is under the configured
  project-home root at `Repositories/`; users can change it through a setting
  validated to an allowed absolute location, and the chosen value is persisted.
  Changing this setting affects future managed base checkouts; existing
  checkouts and worktrees retain their recorded paths and are never silently
  moved.
  Remote repositories are organized by normalized URL host, organization, and
  repository name. URL credentials and unsafe URL components never become path
  segments. Local-only repositories use an identity-derived namespace.
- The repository library contains a managed base checkout per verified
  repository identity. Existing source checkouts are never moved or modified.
  Refresh of a managed base checkout is explicit and retryable; provisioning
  uses verified committed state and never silently overwrites user changes in a
  source or managed checkout. Dirty source files remain in the original checkout
  and are not copied into the managed base clone.
- Each Workspace gets its own branch and worktree, stored beside its managed
  base checkout under a stable Workspace-identity path. The Workspace home gets
  a symlink under `repos/<host>/<org>/<repo>` pointing to that Workspace's
  worktree, not to the shared base checkout. The symlink is a convenient alias
  only. Rust verifies its target, and OpenCode receives the canonical actual
  worktree root as its working directory.
- Every repository worker session's `cwd` is the actual Git worktree root so
  repository-specific `AGENTS.md` and skills apply. Never substitute a
  synthetic aggregate root or use a symlink as the session context.
- The multi-repository orchestrator's cwd is the Workspace home outside any
  repository. It coordinates by exact app-tracked worker session IDs.
- Existing source checkouts remain in place. Branches/worktrees are explicit
  Workspace-owned resources and setup is retry-safe. Dirty or in-use user data
  is never silently removed.
- Tabs belong to the Workspace and preserve existing OpenCode session, restore,
  terminal, and error behavior where possible. The app restores exact recorded
  session IDs and directories, not a newest-session heuristic.
- A Workspace with substantial file-based work and no repositories still gets a
  Workspace-home session. Quick Requests retain their existing destination and
  lifecycle behavior.

## Lifecycle and retained scope

- Workspace completion is a Workspace lifecycle change; it does not commit,
  merge, or discard code. The final policy for active sessions and cleanup of
  Workspace worktrees must preserve dirty/in-use work and be defined in the
  implementation slice before that behavior changes.
- Repository catalog and Directories behavior remain shared context for new
  proposals. Change Review, Docs, repository tools, and OS handoff must resolve
  only Workspace-associated verified paths.
- Existing Quick Request prompt persistence and OpenCode history behavior stay
  unchanged unless a separately documented compatibility requirement demands a
  change.

## Existing-data compatibility

Backward-compatibility conversion runs only after the Workspace model is ready.
Migration 19 treats existing regular Workspace rows as Workspaces and archives
their legacy regular Task rows in a versioned JSON snapshot in SQLite before
removing those Task rows and associations. Each snapshot includes the owning
Workspace identity/metadata, Task metadata, repository bindings, setup and
cleanup state, exact paths, and session IDs/directories. It excludes Quick
Requests, OpenCode conversation content, and regular prompt contents. The
snapshot is verified within the same transaction before source rows are
removed. Files, branches, worktrees, and OpenCode conversations are never
deleted. The Directories page lists archived records and offers an idempotent
restore of their Task metadata and associations; restored legacy Tasks remain
compatibility data and are not shown as regular work destinations. The
migration and restore are covered by historical file-backed SQLite tests.
Migration 20 repairs databases created by a development build that recorded
schema version 18 before `base_checkout_path` and `workspace_link` were added;
it adds missing columns without rewriting existing paths.

Quick Requests are the explicit compatibility exception: they remain one-off
tracked requests with their original prompt and existing recent/full-list
behavior. Their storage may remain internally specialized; they are not exposed
as regular Workspaces or nested Tasks.

## Deliberately deferred

- Automatic decomposition, related-workspace creation, and multi-workspace
  orchestration.
- Task, Milestone, Stream, dependency, or blocker product abstractions.
- Sequencing or lifecycle meaning for Workspace tags.
- Synchronous completion/result return from a worker prompt tool.
- New app-defined review/commit/merge practices.
