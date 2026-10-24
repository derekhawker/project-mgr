# Workspace Refactor Plan

## Goal

Replace the current Workspace/Task hierarchy with Workspace as the sole regular
work record. A Workspace represents one complete unit of work, whether it is a
bug, an end-to-end effort, or substantial file-based work. Starting from an
original prompt creates exactly one Workspace; the app does not decompose the
work or create related records automatically.

The user reviews an editable proposal before setup. On confirmation, the app
starts the session layout appropriate to the selected repositories, including
when the optional starting prompt is blank. Repository work uses real
repo-rooted branches/worktrees so repository instructions and skills apply.
OpenCode retains conversation history; the app retains only associations and
lifecycle/resource state. Quick Requests remain available for simple one-off
file requests. Commit, review, and merge practice remain repository-directed.

## Delivery tasks

Tasks are implementation slices, not a new product-level Task hierarchy. Keep
each slice buildable and validate it before moving on.

1. **Specify the target and compatibility contract.** Reconcile the application
   workflow, UX specs, glossary, test matrix, and this plan. Inventory current
   records, commands, session owners, paths, migrations, and UI entry points.
   Decide and document how existing Workspace/Task data is preserved or
   transformed; no data-destructive migration is acceptable without an explicit
   recovery path. Completed in `workspace-refactor-target.md`; this target
   contract is now authoritative while legacy behavior docs await rewrite.
2. **Introduce Workspace-owned repository work contexts.** Define Rust domain,
   additive SQLite schema, tags, session roles, and validated branch/worktree
   associations. Preserve the old schema untouched during feature development;
   defer conversion of old records to Task 7.
3. **Add the configurable repository library.** Persist and validate its root;
   organize managed base checkouts by normalized remote host/org/repo (or local
   identity); create Workspace-specific worktrees beside each base checkout;
   create verified Workspace-local symlink aliases that point to those
   worktrees. Sessions always use canonical worktree paths. Existing source
   checkouts are never moved or silently modified.
4. **Implement proposal, confirmation, and setup orchestration.** Original
   prompt yields an editable proposal; confirmation creates one Workspace and
   provisions the selected repo worktrees. Support zero repositories (Workspace
   directory session), one repository (one worktree session), and multiple
   repositories (orchestrator outside repos plus one empty worker session per
   repo). Start sessions even when the optional starting prompt is blank. Make
   partial failure and retry safe and observable.
5. **Implement multi-repository coordination tools.** Add app-provided
   orchestrator tools that target existing worker session IDs and admit
   repo-specific prompts. Keep the worker sessions directly usable by the user.
   Validate the real custom-tool-to-worker loop in an isolated OpenCode
   environment and specify status/result visibility without copying transcripts.
6. **Refactor Workspace workbench and session UI.** Remove Task selection and
   task-specific controls. Present Workspace repo/session tabs, restore exact
   sessions, and adapt Change Review, Docs, Tools, and OS handoff to Workspace
   contexts. Preserve Quick Request screens and terminal lifecycle behavior.
7. **Migrate legacy records at the end.** After the new model works, archive a
   versioned document containing all relevant legacy Workspace/Task metadata,
   associations, resource paths, cleanup/setup state, and session IDs in a
   deleted-records table. Verify the archive, then convert supported records to
   the new model. Implement and test an explicit undelete/restore path. Quick
   Request records and prompt behavior remain preserved. Never delete worktrees,
   branches, files, or OpenCode history. Conversion failure must leave the
   archive and source data intact and actionable.
8. **Final validation and documentation closeout.** Run focused and broad
   Rust/frontend suites, migration and real-Git tests, and installed OpenCode
   integration checks. Update the integration matrix and all affected docs.
   Stop at the final manual Wayland/provider acceptance gate; report the exact
   remaining user-run steps rather than claiming they passed.

## Guardrails and completion criteria

- Rust owns business behavior, validation, persistence, process/session
  ownership, and Git/worktree operations; frontend remains presentation and
  command adaptation.
- Every repo worker session uses the exact corresponding worktree as its
  canonical directory. Workspace-local symlinks are convenience aliases only,
  and are never used as a substitute for the actual worktree context.
- The multi-repo orchestrator is rooted outside repositories; it coordinates
  existing worker sessions through app-provided tools, not OpenCode subagents.
- Prompts are transient inputs. Never persist regular Workspace prompts or
  include prompt text in application logs. OpenCode owns conversation history.
- Side effects are retry-safe; partial setup never silently creates duplicate
  Workspaces, worktrees, branches, or sessions.
- Quick Requests retain their distinct one-off lifecycle unless a required
  compatibility change is documented.
- Layout, rendering, terminal, window, tray, and visual lifecycle acceptance
  remain manual on Wayland.
- The refactor is complete only when the target behavior works end to end,
  historical user data is protected, applicable tests pass, and affected docs
  and the integration matrix match the implementation.

## Progress

- [x] Accepted product goal and task breakdown recorded.
- [x] Task 1: specify target and compatibility contract.
- [ ] Task 2: Workspace-owned repository work contexts (in progress: schema,
  session-role DTOs, persistence, tag normalization, and command-path recording
  of worktrees/session roles landed; Workspace-only integrations and task
  cleanup/lifecycle replacement remain).
- [ ] Task 3: configurable managed repository library and aliases (in progress:
  persisted/validated library root, Directories setting UI, scan exclusion, and
  Rust real-Git provisioning for managed bases, Workspace-specific worktrees,
  and Workspace-local symlinks is connected to Workspace confirmation. Tauri
  orchestration coverage and visible per-worktree retry/recovery UI remain.
  Workspace worktree records now retain base, worktree, and alias paths so
  retries stay on the original paths if the library-root setting changes).
- [ ] Task 4: proposal, confirmation, and setup orchestration (in progress:
  confirmation now provisions repo-rooted worktrees and creates the cardinality-
  appropriate session layout; starting prompts are optional and route to the
  orchestrator for multi-repository work; retries retain recorded repository
  paths across library-setting changes. Proposal model still carries legacy
  Task options, and end-to-end process orchestration/retry coverage remains).
- [ ] Task 5: multi-repository coordination tools (in progress: generated
  Workspace-local OpenCode plugin routes repo-specific prompts to the exact
  persisted worker session ID and acknowledges admission only. Live installed-
  OpenCode tool execution and production orchestration/retry coverage remain).
- [x] Task 6: Workspace-only workbench/session UI and integrations. New-work
  offers only Workspace/Quick Request; navigation lists Workspaces without
  legacy Task destinations; regular Task setup/lifecycle controls are removed;
  Change Review, Docs, repository tools, and OS handoff accept Workspace owners
  only; Workspace completion is independent of retained legacy Task lifecycle.
  Quick Request remains distinct.
- [x] Task 7: Archive legacy regular Tasks at the final migration boundary.
  Migration 19 snapshots Task metadata, repository/session associations, setup,
  cleanup state, and paths to versioned JSON; verifies it transactionally before
  removing legacy Task rows; preserves Quick Requests and all filesystem/OpenCode
  resources; and provides idempotent restore from the Directories page. Historical
  file-backed SQLite coverage verifies worktree/session/cleanup recovery.
  Migration 20 also adds conditional compatibility repairs for v18 databases
  created before the repository base-path and workspace-link columns existed.
- [ ] Task 8: Ready for end-to-end validation and manual acceptance. Full Rust
  and frontend suites, production build, Rust formatting, and diff checks pass.
  Interactive GUI, native terminal/window/tray behavior, and installed plugin
  loading/execution remain manual; use `workspace-refactor-validation.md` and
  record the Wayland/OpenCode environment and results before marking complete.

## Initial architecture inventory

- Rust persistence and DTOs are concentrated in `app/src-tauri/src/management.rs`
  and migrations `0001`–`0018`. The current schema has Workspace clone bindings,
  Task worktree bindings, session owner columns for Workspace/Task, and
  task-specific cleanup/setup tables.
- Workspace clones and proposal/setup orchestration live in
  `app/src-tauri/src/workspace_setup.rs` and `lib.rs`. Task branch/worktree and
  setup orchestration live in `task_setup.rs` and `lib.rs`.
- Session creation, terminal lifecycle, and restore are app-owned through
  `opencode.rs`, `terminal.rs`, and `session_restore.rs`; owner-scoped path
  resolution is also used by `change_review.rs`, `docs_reader.rs`,
  `repo_tools.rs`, and `os_handoff.rs`.
- The renderer's owner selection, proposals, tabs, Quick Requests, and workspace
  flows are mainly in `app/src/main.js`, with markup in `app/index.html` and
  command adapters/contracts in `app/src/command-contract.js` and
  `command-contract.json`.
- Current UX and workflow documentation describes the old Task hierarchy. The
  accepted target and compatibility contract is now in
  `workspace-refactor-target.md`; existing specs are labeled as legacy during
  the transition.
- Backward compatibility is deferred until Task 7. The final migration must
  archive and verify a versioned JSON document before conversion, with source
  data retained until conversion and undelete recovery are proven.
- The repo library is configurable; its current proposed default is
  `<project-home-root>/Repositories/`. Managed base checkouts and per-Workspace
  worktrees live there; Workspace-local symlinks point to the actual worktrees.
