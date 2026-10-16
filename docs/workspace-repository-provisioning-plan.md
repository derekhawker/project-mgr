# Workspace repository provisioning plan

## Status

Implementation and acceptance are complete. Extraction constraints, workspace
clone planning/provisioning, durable setup records, session routing, workspace
instructions, Rust-owned Task worktrees, task-rooted sessions, cleanup, retry,
and visible per-step Workspace progress are implemented and validated through
the automated suites and user-confirmed Wayland/OpenCode manual acceptance.
Workspace setup recovery is user-directed: the UI shows the failed step and
error details, then offers the existing retry action; no automatic
restart-recovery mechanism is required. This plan supersedes older workflow text
that says workspace bindings may use the original repository location. Existing
workspaces and bindings remain unchanged; the new behavior applies to new
workspace attachments.

## Goal

Create a useful workspace from the user's first prompt with deterministic
application behavior. The LLM extracts only the fields needed to make a
reviewable proposal. Rust validates the proposal and owns repository copies,
submodule initialization, task worktrees, workspace instructions, session
directories, persistence, retries, and error reporting.

A workspace remains a workspace even when it has no repositories or tasks. Do
not create a Task or task worktree as a side effect of workspace creation.

## Confirmed product decisions

- For a Workspace with zero or one selected repository, the first prompt
  supplies extraction input and the eventual starting prompt. For a
  multi-repository Workspace, it is extraction/review input only and is not sent
  automatically to any repository session. For a Task, it supplies
  extraction/review input only and is not automatically sent to repo sessions.
  The LLM extracts only fields
  needed for the chosen work type: Workspace name/purpose, Task name/purpose,
  repository IDs, and review reasons for repository matches. Rust rejects
  unknown, disabled, duplicate, or stale IDs. The user reviews and confirms.
- Workspace starting prompts initially equal the exact original prompt and are
  user-editable in review. The LLM does not rewrite prompts, return operational
  effects, select commands, create a setup plan, or perform Git/setup work. Raw
  original and starting prompts remain transient.
- Each selected source repository must be clean before provisioning. A clone
  contains committed Git data, not uncommitted tracked or untracked changes;
  reject a dirty source instead of silently omitting user work.
- Create independent local Git clones under the managed workspace's `repos/`.
  Never move or mutate the source checkout. Do not hard-link Git objects.
- Use the source repository's configured upstream fetch URL as the clone's
  `origin` when one exists. If there is no upstream, leave the clone without a
  remote. Never leave a push-capable remote pointing at the source checkout.
- With zero repositories, create one workspace-home session. With one
  repository, create one session rooted at its workspace clone. With multiple
  repositories, create one empty session rooted at each workspace clone; do not
  create a generic workspace-home session or submit the prompt automatically.
- Rust coordinates Task setup. Repository work in a Task uses task-specific
  worktrees derived from the workspace clones.
- Rust creates task branches and task worktrees deterministically before it
  creates the Task's OpenCode sessions. Create one interactive session per
  selected repository, rooted at that repository's task worktree. Do not create
  a task-home coordinator session for this flow. If no repository is selected,
  create no repo session; keep the Task record available without an interactive
  terminal until the user attaches a repository or starts a supported session.
- The original task prompt is used for proposal extraction and review only. Do
  not send it, or a generated starting prompt, to any repo session automatically.
  Create the sessions empty; the user decides what to send in each terminal.
- Repo sessions are independent OpenCode conversations, not subagents. The user
  coordinates work across them. Each session discovers the workspace/task
  instructions by ancestry and its own repository instructions/skills from its
  task-worktree directory.
- With multiple repositories, write a deterministic Workspace-root `AGENTS.md`
  that names each independent repository and path, explains that each Task has
  a separate session rooted in the corresponding task worktree and that the
  Workspace has a separate empty session rooted in each clone. Require users
  to keep repository changes in that repo's session. No LLM writes this file.
- Automated package-manager discovery and installation are excluded. The user
  judged a broad manager/lockfile policy too difficult to make deterministic;
  app creation must not run guessed or model-selected package commands. Users
  can install dependencies from the interactive terminal after creation.
- Initialize recursive Git submodules at their pinned gitlink commits. Do not
  fetch Git LFS objects. Submodules are part of their selected parent checkout,
  not separately selected/cataloged repositories; task setup must not edit them
  unless the user separately attaches them.
- The app retains exact directories for existing OpenCode sessions. Adding or
  removing a repository does not rewrite a session's persisted working
  directory; the policy applies when a new session is created.

## Current implementation facts

- New-work confirmation carries a proposal-session identity; Rust retrieves the
  reviewed candidate plan and does not trust renderer-supplied paths. It clones
  selected repositories before creating workspace session(s). Manual
  acceptance found that a two-repository workspace opened only one terminal and
  submitted a prompt; both violate the confirmed multi-repository behavior.
- `repository_attach` now accepts only workspace/repository IDs and provisions
  an independent clone in Rust. `CheckoutMode::Managed` remains the legacy
  linked-worktree mode and is distinct from `CheckoutMode::Clone`.
- `safety::inspect_repository` identifies a repository by its Git common-dir.
  Workspace and task validators persist separate source/clone identities and
  resolve task Git operations through the verified workspace clone.
- Rust creates task branches named `work/<task-id>` and deterministic
  task-home worktrees. It initializes and verifies pinned submodules, persists
  each result, creates empty repo-rooted OpenCode sessions, records the
  task/repository/session relationship, and attaches interactive terminals.
  `task_setup_retry` reuses the persisted confirmed repository selection and
  verified worktrees/sessions.
- The model-driven `register_task_setup` executable and Tauri mutation/start
  commands have been removed from the active command surface. Legacy setup
  records and readers remain for existing tasks and migration compatibility.
- Workspace setup state is persisted per repository, including the reviewed
  plan and ready/failed outcome. Retry within a live proposal reuses the same
  workspace and ready clones. Automatic restart recovery is out of scope; failed
  steps are shown in the creation dialog for user-directed retry.
- Intended workspace session routing is one workspace-home session for zero
  repositories, one clone-rooted session for one repository, and one empty
  clone-rooted session per repository for multiple repositories. Multi-repo
  workspaces also receive an app-managed `AGENTS.md` block that preserves
  surrounding user text. Manual testing found the current runtime does not yet
  meet the multi-repo session/prompt behavior.
- Task registration and cleanup resolve the verified Workspace checkout
  (including clone identity); branch ownership conflicts are scoped within the
  workspace. Real-Git tests cover deterministic worktree creation/reuse,
  separate workspace clones, two-repository Task setup, repo-rooted session
  persistence, and cleanup against the clone rather than the source.
- There is no production package-manager detection or installation code.
- Existing app workflows state that repositories may remain at their original
  locations. That statement and the checkout/session workflow specifications
  must be revised for the new behavior.

## Deterministic end-to-end flow

### 1. Extract and review

1. The GUI sends the exact first prompt and explicit work type to the internal
   proposal flow. Rust supplies only enabled catalog entries as repository
   candidates.
2. The LLM returns strict JSON with only the extraction fields above and
   repository IDs from that candidate list. The parser rejects extra fields,
   malformed values, duplicate IDs, disabled IDs, and IDs absent from the
   current catalog.
3. Rust builds a read-only setup plan for the selected repositories. It
   canonicalizes and re-inspects each source, records its current HEAD and
   default branch, rejects dirty sources or ambiguous default branches, and
   reads upstream and submodule metadata.
4. The review shows the extracted workspace name and purpose; each repository's
   catalog name, full source path, and extraction reason; each destination path;
   and any detected `.gitmodules` submodule summary. The user can accept or go
   back and correct the prompt. No records or clones exist before confirmation.
5. If a repo is matched semantically rather than named explicitly, its reason
   must be grounded in the supplied catalog purpose and the original prompt.
   The review identifies it as an LLM match, not a verified fact. Rust still
   controls the selected ID and path.

### 2. Revalidate and provision

On confirmation, Rust revalidates all facts from the plan; the renderer is not
trusted to supply arbitrary paths or commands. If a source HEAD, identity,
cleanliness, enabled state, default branch, remote, or submodule metadata
changed since review, require a fresh review rather than silently proceeding.

For each selected repository, in stable repository-ID order:

1. Choose a stable, safe destination beneath `<workspace-home>/repos/`, based on
   a sanitized catalog name plus a stable repository-ID suffix. The path does
   not depend on selection order and same-name repositories cannot collide.
2. Clone the canonical source path into an app-owned staging directory with the
   fixed argument vector `git clone --no-hardlinks --recurse-submodules --
   <source> <staging>`, explicitly checking out the source's verified default
   branch. Never invoke a shell and never perform Git mutations in the source.
3. Verify the clone is a separate Git root/common-dir, is at the expected
   commit/branch, is contained beneath `repos/`, and has no alternates or
   hard-linked object dependency on the source. Set `origin` to the validated
   source upstream fetch URL, or remove the local-path origin when no upstream
   exists. Do not copy a source `pushurl` pointing to the source checkout.
4. Verify recursive submodules are checked out at their pinned commits and
   every submodule path stays under the clone. Do not fetch Git LFS objects.
5. Atomically rename the verified staging directory to its final path, then
   persist the workspace binding with both catalog/source identity and the
   clone's independently verified checkout identity.
6. Generate/update the app-owned multi-repository instruction block in the
   Workspace-root `AGENTS.md`. Preserve user-authored sections; only replace a
   clearly marked app-owned block. With zero or one repository, do not add the
   multi-repository block.
 7. Create and record workspace session(s) only after repository paths are
    stable. Create one workspace-home session for zero repositories, one
    clone-rooted session for one repository, or one empty clone-rooted session
    per repository for multiple repositories. Attach each PTY in its persisted
    directory. Submit the starting prompt only for zero/one-repository work.
    OpenCode history remains OpenCode-owned.

Workspace initialization is durable even if clone, submodule initialization, or
OpenCode startup fails. Preserve completed copies and user changes; record
per-repository outcomes and offer idempotent retry. Never claim a repository or
workspace is ready when setup is incomplete. Do not run dependency installers
as part of this flow.

### 3. Use workspace clones for task worktrees

1. Task extraction returns a task name/purpose and only repository IDs attached
   to the selected workspace. The user reviews and confirms those fields.
2. Rust creates the task home, then for each selected workspace clone creates a
   task-owned branch using the fixed deterministic name `work/<task-id>` and a
   worktree under `<task-home>/worktrees/<stable-repository-directory>/` from
   the workspace checkout's recorded default branch.
3. Rust initializes each task worktree's recursive submodules at their pinned
   commits, without fetching LFS. Validate every path and Git identity before
   recording the binding.
4. A retry verifies and reuses a correctly recorded branch/worktree. A
   conflicting branch, path, or Git owner becomes an explicit setup failure;
   never choose a random alternative.
5. Branch-conflict checks are scoped to the workspace clone: the same branch
   name in independent workspace clones is not a collision; two active tasks
   competing for a branch in the same clone are.
6. Cleanup resolves the same workspace clone and removes only a verified clean,
   unused task worktree. It never removes the workspace clone or a source repo.
7. Only after all selected repository setups are durably recorded does Rust
   create one interactive OpenCode session per selected repository, with each
   session's `location.directory` set to its task worktree. Persist each exact
   session ID, directory, and repository binding under the Task, attach a TUI
   for each, and send no prompt. If session startup partially fails, retain
   successful sessions and report failed repository sessions without claiming
   the Task is fully ready.

This removes the current model-driven Git setup prompt and the
`register_task_setup` MCP mutation path. Rust is authoritative for branch and
worktree creation, validation, session routing, and persistence. The user
interacts directly with each repo-rooted OpenCode session; no model-driven
subagent delegation or prompt fan-out is required.

### 4. Package-manager execution is out of scope

The app does not scan for package managers or run dependency installation
commands during workspace/task creation. This avoids nondeterministic
manager/lockfile selection and implicit execution of repository lifecycle
scripts. Dependency setup remains an explicit user/OpenCode action in the
interactive terminal. Revisit automatic installs only with a bounded,
deterministic manifest/command contract and renewed user approval.

## Persistence and module seams

- Keep `repository_catalog` as the identity/path of the explicitly discovered
  source. Never catalog workspace clones as duplicate source repositories.
- Extend workspace bindings to distinguish `existing`, linked-worktree
  `managed`, and independent `clone` checkouts. Store source identity and clone
  checkout identity separately; store exact paths and default branch. Use a
  SQLite migration that preserves existing bindings unchanged.
- Persist workspace clone and submodule setup outcomes so the UI can report each
  result and a user-directed retry can reuse verified clones without rewriting
  user changes. Automatic recovery after application restart is out of scope.
- Persist deterministic task branch/worktree setup outcomes and associate each
  Task session with its repository binding as well as the Task owner. Add a
  nullable repository association to session records through a forward
  migration; workspace and legacy sessions remain valid with no repository ID.
  The setup result is no longer inferred from an LLM-authored registration
  report.
- Keep session working directories exact and durable. Existing session rows are
  never rewritten when workspace bindings change.
- Put setup orchestration behind a Rust `workspace_setup` module interface. Its
  caller supplies validated repository IDs and confirmation data; it returns a
  typed report with paths and itemized outcomes. Keep Git mutation in
  Rust-owned modules. `lib.rs` remains the Tauri adapter;
  frontend JavaScript renders state and sends explicit commands only.
- Use internal seams for command execution so tests can assert exact Git
  argument vectors. Also exercise real Git with temporary repositories and
  isolated SQLite rather than relying only on fakes.

## Implementation sequence

Deliver one complete user-visible vertical feature; the sequence below is
dependency order, not permission to ship an incomplete intermediate behavior.

1. **Constrain extraction — complete:** simplify the proposal JSON/prompt to extraction
   fields; validate exact enabled catalog IDs in Rust; preserve the original
   prompt for Workspace starting-prompt review while keeping Task prompt text
   transient and unsent; test Rust serialization/validation and frontend
   command/result/error handling.
2. **Add setup persistence and planner — implemented:** migrate workspace checkout state;
   implement pure path, branch, and repository preflight planning; test
   collisions, disabled/stale IDs, dirty sources, submodule metadata, and plan
   changes between review and confirmation.
3. **Provision independent clones — implemented:** implement staging, fixed Git arguments,
   source immutability, identity/branch/remote validation, stable paths,
   idempotency, and recovery. Test success and failures with real local Git
   fixtures; prove two workspaces get independent clones of one catalog source.
4. **Generate instructions and route sessions — implemented:** generate the marked static
   multi-repo `AGENTS.md`; choose workspace session cwd before OpenCode session
   creation; test create, later workspace sessions, restore/recovery, zero/one/
   multiple repo cases, and failed session startup.
5. **Make task Git/session setup deterministic — implemented, partial-failure acceptance remains:** create branches/worktrees and
   pinned submodules in Rust; add a session-to-repository migration; create and
   persist one empty OpenCode session per selected task repository at its
   worktree; update cleanup and branch collision scope. Remove model-driven
   registration MCP setup. Test one and multiple repositories, partial
   setup/session failure, retry, and workspace isolation.
6. **Validate end to end — pending coverage gaps:** run full Rust and frontend suites, formatting, and
   production build; verify real Git and submodule integration; manually
   validate on Wayland. Run the documented multi-repo scenario by opening each
   tracked repo session and verifying its exact worktree directory, local
   instruction/skill load, marker, and per-repository diff. Do not claim skill
   discovery based only on an `AGENTS.md` result.
7. **Close documentation:** reconcile command contracts, migrations, integration
   matrix, and handoff with implemented behavior. Workflow and UX decisions are
   already reconciled to the agreed design.

## Required test coverage

- **Extraction:** strict schema, exact candidate-ID membership, disabled and
  stale repository rejection, duplicates, malformed/extra fields, ambiguous
  matches, and no side effects before confirmation. Raw prompts never enter
  durable app records/logs.
- **Clone:** source clean/dirty, unknown default branch, source changed after
  review, destination collision/symlink, clone failure/partial staging,
  separate Git identity/object store, expected branch/commit, upstream and
  no-upstream remote behavior, two independent workspace clones, source remains
  unchanged.
- **Submodules:** nested and relative URLs, upstream and no-upstream cases,
  pinned commits, untrusted/out-of-root paths, missing remotes, partial clone,
  task worktree initialization, and no LFS object fetch.
- **Sessions:** persisted OpenCode API location, database directory, and PTY cwd
  agree; zero/one/multiple repositories; initial and later workspace sessions;
  restoration uses stored paths; each selected task repository has its own
  empty session rooted at its task worktree.
- **Task Git/sessions:** reject source paths/identities, clones from another
  workspace, outside paths, wrong branches, or duplicate branch owners; cleanup
  addresses the clone that owns the task worktree. Each selected repo gets
  exactly one empty session rooted at its task worktree, with the matching
  repository association. Zero selected repos creates zero repo sessions. No
  task prompt is automatically sent.
- **Tauri contracts:** Rust tests cover command behavior and serialized results;
  frontend tests cover command names, payloads, success, and errors.
- **Manual OpenCode:** verify each separately created repo session uses its
  task-worktree directory and discovers repository-local instructions/skills
  with the fixture evaluation. Built-in subagents are not part of this design.

## Open implementation checks

No product decisions are open. Verify Git's relative-submodule URL behavior
with local fixtures for the fixed `git clone --no-hardlinks
--recurse-submodules` flow. Follow standard Git resolution, and do not introduce
custom URL rewriting or remote sanitization for submodules unless the integration
evidence shows the selected flow cannot satisfy the confirmed behavior.
