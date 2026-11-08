# Idea-first release: implementation-plan handoff

**Status:** approved for implementation; release acceptance pending.

**Prepared:** 2026-11-07, after the parent's review of the planning concerns.

**Release:** one complete product release, including eligible existing-Workspace
migration. Tasks below are internal implementation boundaries, not partial releases.

## Current migration source: backed-up database

On 2026-11-08, at the user's direction, `management.sqlite3` and its WAL/SHM
sidecars were moved out of `~/.local/share/dev.opencode.projectmgr/`. The original
files are retained in
`~/.local/share/project-mgr-backups/management-20261108T212059912465Z/original-files/`.
The separate SQLite online backup at
`~/.local/share/project-mgr-backups/management-20261108T212059912465Z/management.sqlite3`
passed `PRAGMA integrity_check`. Other existing backups, repositories and OpenCode
sessions were not touched.

The user wants a fresh replacement database and later migration from this backup.
No migration has run. The current migration commands expect a configured source
and a verified backup bundle; adapt and validate the workflow for the saved source
before use. Do not assume the old database remains in app-data or that the SQLite
snapshot alone is a verified bundle. Retain both the snapshot and original files;
live migration requires separate authorization.

## Approval and authority

This file tracks the approved implementation. Partial work and its limits are
recorded below; the complete production mechanisms and release acceptance remain
unfinished. Reviewing this plan alone does not authorize live database mutation,
installation, cleanup, service restart, provider requests, or runtime changes.

- **Plan approval:** user requested implementation of the complete handoff on
  2026-11-07, explicitly authorizing subagents and a full replacement. Explicit
  migration and preservation requirements remain in scope; compatibility not
  explicitly required is not a goal. Live rollout and external-provider calls
  remain separately authorized as specified below.
- **Implementation evidence:** partial isolated startup, runner and test work is
  recorded below. Research results and historical baselines are not completed
  release tasks or current end-to-end passes.
- **Execution revision:** the user directed a product-first order and deferred
  large integration-fixture work until the implemented workflows need it. The
  [execution order](#product-first-execution-order) supersedes earlier sequencing
  instructions, not the release outcomes or safety requirements.
- **Live rollout:** a later user action with reviewed targets and verified backup.
  Implementation approval does not let a coding agent migrate the user's live
  store, install into their normal OpenCode configuration, stop their running
  server, or clean their directories without that explicit authorization.
- **Preservation:** keep the user-owned `npm run live --prefix app` runtime,
  existing work, nine prior proposal/research documents, research branches, active
  checkout/common `.git`, and all actual repositories/checkouts/worktrees intact.
  Planning performs no cleanup. Implementation fixtures own only isolated data.

## Read first and follow on the named branch

The following documents own requirements; this plan owns task allocation and proof.
Read the three primary documents fully when starting or resuming implementation.
If they genuinely conflict, record the conflict and seek resolution rather than
inventing a competing requirement in this file.

| Reference | When to consult / authority |
|---|---|
| [Implementation readiness](idea-first-implementation-readiness.md) | Latest selected decisions, evidence limits, preserved experiment sources, migration boundary, and requirements for this plan. |
| [Product proposal](idea-first-project-mgr-proposal.md) | Product scope, organization/workbench, directory model, service lifetime, migration, and exclusions. |
| [Ticket/session protocol](ticket-session-protocol-proposal.md) | Instruction ownership, logical operations, authority, decisions, lifecycle, native attribution, and recovery. Proposed identifiers are not existing APIs. |
| [Runtime/storage experiments](ticket-runtime-storage-experiments.md) | T02/T05/T11: cooperating writers, operational authority, backups, and transport limits. |
| [Native-operation experiments](opencode-native-operation-experiments.md) and [tool-observation research](opencode-tool-observation-research.md) | T03/T06/T07: installed-version hooks, invocation-local correlation, partial effects, move application, and destination capability. |
| [Session-context experiments](opencode-session-context-experiments.md) and [workflow research](opencode-workflow-integration-research.md) | T03/T06/T08: before-generation child admission, context/skill refresh, native reuse, forms/service source facts, and unvalidated paths. |
| [Application workflows](application-workflows.md), [app conventions](../app/README.md), [UX index](ux/index.md), [glossary](ux/glossary.md), [integration matrix](integration-test-matrix.md) | Current/older implementation context and documents to update with changed behavior. They do not veto the reviewed new design. |
| [Repository instructions](../AGENTS.md) | All tasks: Rust behavior ownership, async/bounded blocking orchestration, frontend organization, test policy, safety, and documentation duties. |

Research fixture sources are preserved on the three local branches listed under
[preserved executable fixtures](idea-first-implementation-readiness.md#preserved-executable-fixtures).
Inspect/export selected source into isolation when useful; do not merge their
standalone prototype histories into the application. Historical 16-group runtime,
64-assertion native, and 29-assertion context reruns establish only their documented
boundaries. They do not establish this release's production authority, migration,
packaging, forms, GUI, provider, or native acceptance.

## Request coverage and release boundary

This is the request-coverage map for the complete release. Detailed semantics stay
in the linked specifications. `E01`–`E12` name final evaluation scenarios in T12.

| ID | Required outcome / disposition | Implementation owner | Final proof |
|---|---|---|---|
| C01 | Standalone offline idea capture; Inbox/All work; grouping, ranking, priority, tags, filters and explicit dependencies without execution setup. In scope. | T02, T09 | E01 |
| C02 | Organizational Workspaces, zero-ticket use, existing/new local-repo convention, direct repository reuse, retained notes and conversations. In scope. | T04, T09, T10 | E02, E03 |
| C03 | Canonical independent Markdown, external editing, rebuildable indexes, operational SQLite, coherent backup/restore. In scope. | T02, T05 | E01, E10 |
| C04 | Exact native session/service identity; explicit binding, current context, instruction/router activation, native child roles and provenance. In scope. | T03, T05, T06 | E04, E05, E09 |
| C05 | One repository or non-Git context per run; native worktrees/moves/adoption, invocation-local journaling, uncertain-effect recovery and safe cleanup authority. In scope. | T07 | E04, E05, E09 |
| C06 | Whole-plan scope approval and result acceptance/request changes through session forms; delivery remains separately authorized. In scope. | T05, T08 | E04, E06 |
| C07 | Owner-idle Blocked fallback, explicit checkpoint diagnostics, stale/duplicate/reconnect safety; subagent idle is not owner idle. In scope. | T05, T08 | E06, E09 |
| C08 | Ticket Overview/Conversation/Changes; Tools on every view, including Draft/no context; actual ticket file versus verified execution target. In scope. | T10 | E03, E07 |
| C09 | Shared CLI service survives GUI quit with owner/subagent/plugin work; reopen same sessions without replacement or starting-prompt resend. In scope. | T03, T06, T10 | E08 |
| C10 | Eligible zero/single-repo migration with zero tickets; new local repo for existing repo-free Workspaces; historical/completed provenance retained. In scope. | T11 | E11 |
| C11 | Excluded multi-repo DB unlink and only proven obsolete artifacts/alias cleanup; retain all actual repos/worktrees/history, archives, and recoverable manifests. In scope. | T11 | E11 |
| C12 | Quick Requests unchanged in lifecycle/history/original-prompt exception; shared-service lifetime applies globally. In scope. | T03, T09, T10, T11 | E08, E12 |
| C13 | Production command/IPC, relocated package, installed runtime, full recovery evaluation, documentation and separate manual native acceptance. In scope. | T01, T05, T12 | E01–E12 and native checklist |
| C14 | Coordinated multi-repository execution. Release two; not implemented here. Organizational repository references do not authorize such a run. | Excluded | Negative run-admission check in E05 |
| C15 | New daemon/orchestrator runtime, transcript copies, automatic migration tickets, mandatory notes editor/folder, repository mirrors/symlink layer, dedicated revision-history UI, unattended scheduling/tracker sync. Excluded. | All tasks preserve boundary | T12 scope audit |
| C16 | Host enforcement after deliberate plugin removal; cryptographic human identity against equivalent same-user clients; arbitrary in-flight seamless upgrade. Not claimed. | T02, T03, T06, T08 | Explicit limits and degraded/recovery checks, never a substituted guarantee |

## Reviewed concerns and implementation gates

The parent accepted all nine concerns as requirements, not new user-intent blockers.
This is their single register; task sections give the actual deliverables.

| Risk | Evidence / concern | Lead owner; related tasks | Pass or stop gate |
|---|---|---|---|
| R01 | Canonical Markdown updates and recovery require validation. | T02; T05 | Validate revision checks, journal recovery and preservation of pending evidence. |
| R02 | `ManagementStore::from_connection` auto-migrates/checkpoints/syncs; Tauri starts legacy recovery/cleanup immediately afterward. | T01; T02, T11 | GUI and adapter gate side-effecting store opening and workers before backup/inventory/recovery. Product/filesystem migration is not an ordinary SQL startup transaction. |
| R03 | `0019_legacy_task_archive.sql` and other owner FKs restrict Workspace removal; legacy cleanup must retain actual repositories. | T11 | Retention representation and independent cleanup manifest survive unlink and crash with FKs enforced; retained Git/files/history unchanged. |
| R04 | `Runtime::ensure_started_locked`, `shutdown`/`Drop`, tray Quit and installed contract tests own/kill a private server. | T03; T12 | Authenticated shared connection and safe old-owner handoff; quit/reopen preserves ongoing owner/subagent/plugin work, no duplicate session/prompt. Correct unsupported history limit500 with real contract proof. |
| R05 | Session owner/directory immutable; migration24 roles and restore assume managed Workspace paths. | T05; T03, T11 | Service-qualified, generation-checked bindings and reconciled mutable context work through real core; old/stale/worker writes reject; Quick Requests keep their semantics. |
| R06 | Research proves bounded native/context feasibility, not production plugin/form/idle behavior; current coordinator is local and fixed-worker. | T06; T07, T08 | Packaged service-side bridge, native foreground/background child admission, form continuation and idle/reconnect tests pass. Failed required native seam blocks release; no silent replacement by custom dispatch. |
| R07 | Creation/discovery/readers depend on wrapper homes, managed-library exclusions, mirrors and aliases. | T04; T10, T11 | Ordinary local/retained repos explicitly register; safe discovery and retained notes work without wrapper/mirror/symlink. Bootstrap collision/identity/partial-success retries preserve data. |
| R08 | Tools/Docs/Changes currently resolve Workspace homes/managed metadata, not ticket file/run context. | T10 | Rust resolves identity/action to correct file/context on every view; absent context neither hides file actions nor provisions resources. Stable terminals and stale-selection safety demonstrated. |
| R09 | Existing tests are not full-release E2E; no explicit native app-path override found; bundling disabled and historical suite failures documented. | T12; T01, T05 | Minimal isolated production seams and concrete runners exist; fresh baseline recorded, relocated package works GUI-closed, separate IPC/native proofs retained. Unrun/failed required gates remain release blockers. |

## Task status and dependencies

Update this table and the implementation record below after each completed task
or blocked gate. Task completion requires its stated proof, not just a partial
implementation or an isolated experiment.

| Task | Outcome | Depends on | Current status |
|---|---|---|---|
| T01 | Safe entry/configuration and acceptance foundation | Plan approval | In progress |
| T02 | Canonical Markdown store, conflict handling, backup/recovery | T01 | Partial isolated capture/read library; storage and recovery validation remain incomplete |
| T03 | Shared OpenCode connection, restore and runtime lifetime | T01 | Partial isolated history fix; T01 dependency open |
| T04 | Organizational context and ordinary repository bootstrap | T02 | Not started |
| T05 | Rust work authority and packaged one-shot adapter | T02, T03, T04 | Not started |
| T06 | Service-side context bridge and instruction package | T05 | Not started |
| T07 | Native effects, attribution and reconciliation | T06 | Not started |
| T08 | Session decisions and lifecycle observation | T07 | Not started |
| T09 | Capture and organization presentation | T02 capture interface; T04/T05 for dependent features | Not started |
| T10 | Ticket/Workspace workbenches and verified Tools/readers | T08, T09 | Not started |
| T11 | Historical migration and bounded legacy cleanup | T10 | Not started |
| T12 | Complete-release integration and executable E2E acceptance | T01–T11 | Not started |

These dependencies identify required capabilities, not a ban on implementing a
usable part of a later task. T09 offline capture needs T02's safe capture/read
interface and T01's fresh-store admission; it does **not** need T04 workspace
provisioning, T05 execution authority, or T06–T08. Workspace and managed execution
features still require their actual dependencies. One integration owner maintains
shared contracts. No task is complete until its own required proof passes.

## Product-first execution order

The previous execution spent too much effort on fixture ownership, repeated audits,
and disconnected services while the application stayed unusable. Preserve that
work; do not expand or delete it merely to satisfy this revision. Resume as follows:

1. **Reconcile the two checkouts.** Read their status and this record; review the
   latest unreviewed capture-intent changes. Keep all uncommitted work. Use the
   isolated Rust worktree while the primary checkout may be watched by the user's
   runtime. Integrate changes only after checking the effect on that runtime.
2. **Enable the fresh-store path.** Implement safe admission and initialization
   for an explicitly configured new store, and make the replacement application
   accessible for that path. Existing stores and sidecars must remain blocked
   before legacy migration, workers or cleanup until T11's inventory and verified
   backup permit them. This is not authorization to touch live data. Do not make
   native GUI acceptance a prerequisite to implementing the next slice.
3. **Deliver offline capture vertically.** Connect T02's canonical capture/read
   service through production Rust commands and T09's presentation. Saving,
   listing and reopening an unassigned idea must not start OpenCode or create a
   workspace, repository, session or run. Implement the smallest safe production
   path first; do not grant execution authority from draft content. The broader
   T02 journal, backup and recovery validation remain required.
4. **Extend real workflows in dependency order.** Add organization and ordinary
   workspace/repository context (T02/T04/T09); shared sessions and Rust authority
   (T03/T05); native bridge, effects and forms (T06–T08); workbenches (T10); then
   historical conversion and bounded cleanup (T11). Build and connect each
   capability to its actual caller, rather than accumulating unwired services.
   Begin an independent ready slice when another slice is blocked; do not cross a
   safety or authority gate that the slice genuinely requires.
5. **Finish integration at T12.** Once the product workflows exist, complete only
   the fixture/runner capabilities needed to exercise the required deterministic
   and installed scenarios, then run the permitted non-GUI end-to-end checks.
   E01–E12 evidence, migration safeguards, documentation, manual native acceptance
   and the separately authorized provider check are not waived. Do not run E2E GUI
   tests in this implementation session; record GUI acceptance as unvalidated for
   a later human-authorized native check.

During implementation, use focused regression and integration tests where they
directly establish a changed rule or safety boundary. Defer broad scenario suites,
packaging/runner infrastructure and cross-feature integration fixtures until their
product workflows are ready. A feature may be recorded as **implemented, focused
checks passed; integration pending**, but not as a completed task or release when
its stated acceptance proof is missing. A safety mechanism may not be bypassed
simply because its integration test is deferred.

Use at most one GPT-6 Luna implementation subagent at a time. The integration
owner reviews and integrates that work. Use another agent only for a concrete
blocker or meaningful integration test; use GPT-6.1 Terra for a genuine blocker.
Continue ready approved work after checkpoints. Avoid repeated speculative
prototypes, audits, and test scaffolding when a production slice can proceed.

Implementation review refinements: T01 must address store-absent admission and
isolated instance identity before single-instance routing; legacy backup must
include WAL-consistent pre-upgrade data independently of the new ticket store.
T03's connection/lifetime work precedes T05, but service-qualified ticket binding
and mutable-location restore require post-T05 integration before final acceptance.
T05/T08 jointly define the trusted form source, correlation and recovery ordering.
T11 inventories all relevant foreign keys, triggers and cleanup references before
unlink. T10/T12 inventory replacement and retirement of legacy regular-work
commands, routes, setup and workers while retaining required migration and Quick
Request behavior. Existing-session adoption must be exercised through production
UI/service paths, including safe active-session boundaries and missing contexts.
Existing repository-backed ticket import is not silently performed or synchronized;
its disposition must be resolved against the proposal before release.

### Common task completion rule

For each slice: add/extend the smallest behavior-level regression; demonstrate the
missing behavior before production changes where practical; implement through
production services and their actual caller; run focused checks; update affected
living docs and matrix rows; record results and unvalidated paths here. Defer
cross-feature and installed integration suites to T12 unless needed to resolve a
concrete implementation risk. Use real
isolated SQLite/Git/filesystems for those boundaries, and substitute only external
effects needed to control failure. Cover both sides of changed Tauri commands with
Rust serialization and frontend payload/result/error checks. Source-text tests are
reserved for inventories/architecture, not behavior; tests must not merely freeze
CSS preferences. Preserve Rust ownership and bounded blocking executors.

## T01 — Safe entry points and minimal evaluation foundation

**Boundary:** shared startup/config admission before side-effecting store opening;
minimal isolated evaluation seams, not conversion or service ownership.

**Inputs:** R02/R09; [migration boundaries](idea-first-implementation-readiness.md#migration-boundaries-and-evidence);
`lib.rs::run`, `management.rs::{open_with_paths,from_connection,migrate}`,
`tauri.conf.json`, `app/scripts/test-safe.js`, current test/command conventions.

**Owned deliverables:**

- New app/adapter CLI contract: `--app-config <absolute-config-file>` and a
  versioned Rust-decoded config for app data/logs, ticket/repository homes and
  selected connection. Document precedence/path validation; T03 supplies connection
  details. This is missing production functionality, not an existing env override.
- Read-only upgrade admission shared by GUI/adapter, ahead of migration/checkpoint/
  home synchronization and legacy workers currently reached at `lib.rs:147–175`.
  Expose pending upgrade/recovery; T11 owns conversion and backup admission.
- T12 runner scaffold: help, owned-root validation, fixture manifest/evidence schema.
  Record a fresh baseline and deterministic/installed command split. Add only the
  path/config/process seams needed here, not a general testing framework.

**Exclusions:** live upgrade, new migration policy, actual conversion/cleanup,
service startup/handoff, global user configuration edits, full scenario runner.

**Validation-pass:** production config tests reject invalid isolation without DB/
project/process effects or live-path fallback. GUI and headless historical fixtures
reach admission with bytes unchanged before backup; app-only status needs no
OpenCode. Record actual baseline failures/passes, not historical assumptions.
Native launch remains T12.

## T02 — Canonical ticket storage and recovery

**Boundary:** canonical file/index/recovery service; T05 adds authority semantics.

**Inputs:** R01/R02; [ticket authority](idea-first-project-mgr-proposal.md#ticket-authority-keep-one-work-record);
[mutation boundary](ticket-session-protocol-proposal.md#markdown-mutation-and-operational-commit-boundary);
runtime report sections on storage protocol, authority, and backup.

**Owned deliverables:**

- Versioned ticket encoding/scope projection, canonical read/mutation API,
  cross-process journal/recovery and rebuildable index implementing the linked
  authority/mutation contracts. Cover identity/path changes and invalid/external
  file states; expose readable canonical content during unresolved recovery.
- Validate revision checks and recovery of pending managed updates.
- Coherent Markdown/staging/SQLite snapshot and restore API with verified manifest;
  inconsistent snapshots must retry/report, not bless an inconsistent backup.
  Audit bundled SQLite/WAL settings and state actual filesystem/durability limits.
- Update storage/workflow docs and matrix; provide T05 scope-invalidation signals.

**Exclusions:** native effects, approval/forms, GUI editor, general bidirectional
sync, transcript/prompt persistence, dedicated history UI, live data conversion.

**Validation-pass:** cooperating-process
races yield one winner; stage/intent/file/receipt crashes and corrupt-stage/I/O
failures reopen once or expose preserved conflict. Backup mismatch/incompleteness
rejects restore authority; index rebuild/move preserves identity without setup.
T05 separately validates authority recovery. Full case families: E01/E10.

## T03 — Shared service, exact restore and runtime transition

**Boundary:** shared connection/authentication, exact native restore and old-runtime
handoff; T05/T08 consume observed facts and own ticket authority/lifecycle.

**Inputs:** R04/R05; [service ownership](idea-first-project-mgr-proposal.md#treat-service-ownership-as-a-product-choice);
[session adoption](idea-first-project-mgr-proposal.md#adopt-sessions-and-reconcile-moves);
`opencode.rs`, `terminal.rs`, `session_restore.rs`, tray handling in `lib.rs`,
`tests/opencode_cli_contract.rs`, proposal's documented history-limit defect.

**Owned deliverables:**

- Rust connection/discovery/auth/capability adapter implementing the linked shared-
  service contract, including Quick Requests. Verify private fixture discovery/
  config/auth before test startup; never attach/restart the normal user service.
- Separate shared execution from client/TUI teardown and app-owned shell/tool PTYs;
  replace ownership-opposed shutdown tests. Add service-qualified native readback/
  restore with explicit missing-context recovery, no replacement or prompt resend.
- Correct `Runtime::reconcile_session` line582's unsupported `limit=500`: supported
  history limits/pagination plus current activity/pending-input reconciliation.
- Journaled old-owner inventory/safe-boundary handoff and blocked recovery result
  when handoff is unavailable; prevent duplicate owners/prompts, without claiming
  arbitrary in-flight seamless upgrade. Update runtime/shutdown contract and matrix.

**Exclusions:** a second private production mode, project-mgr daemon, forced live
server replacement, ticket semantic transitions, or automatic migration resumption.

**Validation-pass:** real-client/scripted-HTTP tests cover auth/identity/location,
missing versus unavailable session, bounded current history and rejected unsafe
handoff. Isolated installed contract verifies history pagination/attachment; retry
creates no replacement/prompt. Teardown preserves shared execution while handling
owned tool PTYs. Actual ongoing owner/subagent native quit/reopen is E08, not a
saved-session visibility assertion.

## T04 — Organizational contexts and ordinary local repositories

**Boundary:** Rust organizational/context services and ordinary local repository
bootstrap shared by creation and T11; T09/T10 own their presentation.

**Inputs:** R07; [directory model](idea-first-project-mgr-proposal.md#opencode-projects-directory-and-repository-locations);
[notes collections](idea-first-project-mgr-proposal.md#notes-collections-are-valid-workspaces-without-tickets);
[workspace context](ticket-session-protocol-proposal.md#workspace-context-without-an-active-ticket);
`management.rs`, `workspace_setup.rs`, repository scan functions and Docs roots.

**Owned deliverables:**

- Organizational Workspace/context DTOs and persistence implementing the linked
  directory/notes contracts: retained roots/provenance, future session context and
  remembered destination, plus an explicit non-Git standalone-discussion context.
- Direct existing-repo association and narrowly revised discovery/registration
  exclusions so configured-root repos work without dropping identity/soft-delete/
  linked-worktree safeguards. Adapt Docs backend roots; T10 adds target presentation.
- Reviewed path/name proposal and journaled bootstrap using the configured root,
  login namespace and editable informative name; empty initial `main` commit with
  configured identity. Record ownership before effects and recover exact paths
  after initialization/commit failures or lost receipt. Update directory/notes UX,
  workflows and matrix.

**Exclusions:** execution worktrees, auto conversations, notes folders, remotes or
publishing, multi-repo orchestration, execution approval, actual migration/unlink.

**Validation-pass:** real Git fixtures prove reused dirty source unchanged and
local bootstrap has zero files/remotes, no mirror/wrapper/alias. Missing identity,
hook/signing error and collision fail safely without fabricated authors/global
edits; post-init/pre-commit and post-commit/lost-receipt retries reuse one owned
result. Production registration and non-Git Docs work under retained paths;
historical sessions/files stay put. E02/E03 cover workflow integration.

## T05 — Rust work authority and one-shot adapter package

**Boundary:** shared Rust work authority and transport/distribution; T06–T08 adapt
native runtime events/tools/forms rather than reimplementing these decisions.

**Inputs:** R05/R09; [identities](ticket-session-protocol-proposal.md#authoritative-records-and-identities),
[logical operations](ticket-session-protocol-proposal.md#bridge-operations-and-execution-authority),
[status rules](ticket-session-protocol-proposal.md#ticket-status-and-session-activity-are-different);
T02 scope/mutation contract; T03 service identity; existing Rust wire harness.

**Owned deliverables:**

- Operational schema, production logical-operation service and DTOs implementing
  the linked identity/authority/lifecycle contracts over T02. Include authority-
  aware interrupted-transition recovery and the narrow trusted decision-commit
  entry consumed by T08. Publish store change/reload semantics for GUI reopen.
- New versioned one-request JSON-stdio executable `project-mgr-work` with
  `--app-config`, trusted runtime envelopes and T01 admission. Bound concurrency,
  I/O, deadlines/cancellation and errors; use private pipes/argument arrays, no
  model-selected executable/store. Long native/human waits hold no store lock.
- In-process async/bounded Tauri adapter, command manifest, Rust wire fixtures and
  frontend contract updates; document authority/command/packaging seams and matrix.
- New supported-target distribution/staging solution for app, adapter, version
  manifest and T06 assets. `bundle.active=false` is not an existing sidecar install;
  absolute asset resolution must survive relocation and GUI absence.

**Exclusions:** a listener/daemon, native provisioning implementation, session-form
UI, agent-supplied human attestation, duplicate ticket lifecycle/transcript tables.

**Validation-pass:** real-store tests exercise the linked transition/role/revision
matrix, competing claims, material versus evidence edits and revoked/pending
recovery; rejected authority has no controlled effect and retries commit once.
Separate adapter processes and GUI service agree. Invalid/oversized/versioned input,
launch/store failure, timeout/broken pipe and canaries yield bounded secret-free
errors. Rust DTOs pass the production frontend validator. Relocated adapter works
GUI-closed/outside source cwd; E08 proves the completed plugin distribution.

## T06 — Service-side bridge, context and instruction ownership

**Boundary:** service-side caller/context/admission adapter and instruction package;
T07 owns native resource finalization and T08 owns lifecycle/form observation.

**Inputs:** R06; [instruction inventory](ticket-session-protocol-proposal.md#instruction-ownership-and-invocation),
[concrete entry points](ticket-session-protocol-proposal.md#concrete-opencode-entry-points),
[router branches](ticket-session-protocol-proposal.md#explicit-router-branches),
[delegation sequence](ticket-session-protocol-proposal.md#continue-into-execution-and-delegate-testing);
session-context experiments; existing local coordinator is replacement context only.

**Owned deliverables:**

- Cwd-independent bridge install/repair package preserving unrelated config/assets;
  development installation uses only private fixture config. Wire actual runtime
  caller/context hooks and native child admission/reuse to T05 per linked sequences.
- Implement named readiness errors/same-session retry, reload/move capability checks,
  mode-specific supported tool permissions and degraded repair/reconciliation.
  State auxiliary-generation policy separately from primary hook coverage.
- Package the inventory's bootstrap/router/references/workspace/worker guidance,
  including scoped tool-addressed shared-skill adaptation, repository-policy
  conflict handling and provenance/version output for T10. Update instruction/
  integration contracts and matrix; no global user skill edit during development.

**Exclusions:** host guard surviving plugin removal, custom orchestration replacing
native subagents, native resource finalization (T07), lifecycle/forms (T08), prompts
or full tool bodies in operational metadata or logs.

**Validation-pass:** production plugin/adapter on private installed OpenCode proves
actual first/continuation context and activated skills; foreground/background
native child bind/reuse precedes assigned dispatch. Malformed/stale/competing
claims and prohibited controlled writes reject before effects. Cancellation,
reload/move, missing adapter/policy/plugin and repair retain identity and expose
readiness failures. E05/E09 cover cases. Failed native admission blocks release,
not substitution with custom dispatch. Synthetic scripts prove attachment/path,
not real-model compliance or native presentation.

## T07 — Native effects, verified contexts and reconciliation

**Boundary:** native resource-effect adapter/reconciler over T05 authority,
independent of narration; not a second provisioning manager.

**Inputs:** R06; [tracking protocol](ticket-session-protocol-proposal.md#native-worktree-tracking-protocol),
[attribution matrix](ticket-session-protocol-proposal.md#observation-and-attribution-matrix),
[partial failure](ticket-session-protocol-proposal.md#partial-failure-and-safe-retry);
native-operation experiment and tool-observation research; `safety.rs` Git facts.

**Owned deliverables:**

- Effective native create/remove/move wrappers, including inner Code Mode, and Rust
  intent/result verification implementing the linked protocol. Keep operation IDs
  invocation-local; preserve native schema/executor/strategy.
- Resource adoption, target-serialized move application, live inventory/session/Git
  reconciliation and health output; measure monitoring cost/latency. Implement
  pending-effect recovery and missing-context recovery through production services.
- Future ticket-run cleanup admission/removal with separately verified explicit
  authority and current usage/Git checks. Unlike this capability, T11 legacy cleanup
  preserves **all** actual repos/checkouts/worktrees. Update resource/recovery docs
  and matrix.

**Exclusions:** competing app worktree manager, universal shell/API attribution or
prevention, multi-repo execution, inferred cleanup rights, forced removal without
explicit authority, legacy artifact deletion.

**Validation-pass:** E04/E05/E09 exercise real installed executors through production
wrappers: one tree/association without reporting, concurrent correlation and
unassigned external resources. Pre-effect denial/outage leaves Git unchanged;
post-create failure, missing after hook and lost acknowledgement reconcile without
duplicate provisioning. Delayed/foreign/superseded moves verify actual application;
dirty/active/unknown cleanup rejects or defers. Scripted E04 proves interception;
real-model nested-reference following requires the separate provider/native check.

## T08 — Session forms, lifecycle and owner-idle fallback

**Boundary:** form/event adapters and waiting-tool continuation over T05's decision
and lifecycle rules; no second implementation of those rules in JavaScript.

**Inputs:** R06; [human decisions](ticket-session-protocol-proposal.md#human-decisions-inside-the-opencode-conversation),
[lifecycle](ticket-session-protocol-proposal.md#ticket-status-and-session-activity-are-different),
[finish/reconnect](ticket-session-protocol-proposal.md#finish-while-the-human-stays-in-opencode);
T05 request/receipt core and T03 live activity.

**Owned deliverables:**

- Registered session-form flow and waiting plugin tool per linked decision sequence,
  with persisted reconnect/cancellation and uncertain form-create/receipt recovery.
  Document trusted action path/provenance limits; keep locks out of human waits.
- Owner idle/running and live-reconnect adapter feeding the single Rust lifecycle
  rule while GUI-closed, plus effect-derived checkpoint diagnostics. Update
  activity/decision contracts, workflows and matrix; T10 renders results.

**Exclusions:** free-text approval inference, repeated approval per implementation
task, automatic delivery permissions, a second lifecycle truth, human identity
security claims beyond the agreed trust boundary.

**Validation-pass:** real plugin/Rust flow covers approval/review and E06's stale,
cancelled, duplicate, lost-acknowledgement and waiting-tool reconnect cases without
duplicate forms/rights. Reject worker/self-approval/unregistered decisions. Rust
event tables plus installed observations prove owner idle without checkpoint,
approved resume, explicit-block preservation and stale/subagent/state ordering;
disconnect alone never becomes idle. Native form presentation remains mandatory
T12 acceptance, not inferred from API success.

## T09 — Capture and organization presentation

**Boundary:** capture/organization presentation over T02/T04/T05; T10 owns the
selected ticket's interactive workbench.

**Inputs:** [capture](idea-first-project-mgr-proposal.md#capture-first),
[organization](idea-first-project-mgr-proposal.md#organize-before-working),
[navigation/workbench separation](idea-first-project-mgr-proposal.md#workspace-centered-organization-ticket-centered-interaction);
T02/T04/T05 DTOs, `main.js`, application composition and `views/new-work`.

**Owned deliverables:**

- Capture idea, Inbox/All work and Workspace list components/controllers implementing
  the linked capture/organization specs, with Rust command adapters and fixtures.
- Workspace create/reuse/name review and destination selection using T04; preserve
  Quick Request presentation. Follow frontend/component conventions from app README.
- Update navigation/new-work UX, glossary, current product target/workflows and
  matrix, superseding implemented sole-record assumptions.

**Exclusions:** new transcript renderer, board/hierarchy expansion, execution/context
rules in JavaScript, rich notes editor, T10's ticket workbench or native acceptance.

**Validation-pass:** production DOM/command scenarios E01/E02 save and organize ten
ideas offline, preserve identities during moves, leave bindings/terminals unchanged
and reach zero-ticket Notes/Conversations. Save failure creates no execution setup;
current Quick Request regressions remain covered. Browser usability/layout checks
are presentation evidence, not IPC/native acceptance or CSS preference tests.

## T10 — Workbenches, verified Tools and review surfaces

**Boundary:** workbench composition and Rust file/context target resolution;
consumes authority/activity from T05–T08 rather than deriving it from selection.

**Inputs:** R08; [ticket Tools](idea-first-project-mgr-proposal.md#tools-stay-available-throughout-the-ticket-workbench),
[notes](idea-first-project-mgr-proposal.md#notes-collections-are-valid-workspaces-without-tickets),
[context inspector](idea-first-project-mgr-proposal.md#make-instruction-provenance-inspectable);
`createWorkbenchSessions.js`, terminal registry/runtime, Tools controller/menu,
`os_handoff.rs`, `repo_tools.rs`, `docs_reader.rs`, `change_review.rs`.

**Owned deliverables:**

- Ticket Overview/Conversation/Changes, Workspace conversation entry and on-demand
  child/health/provenance presentation, wired to production readiness/bindings.
- Extend Rust Tools/file handoff and Changes/Docs resolvers to canonical ticket
  document versus verified execution context; reuse existing menu, reader and
  terminal runtime. Preserve page-scoped surfaces and reject stale async actions.
- Update workbench/reader/Tools UX, index/glossary, workflows, capabilities/command
  inventory and matrix. Detailed action semantics remain in the linked Tools spec.

**Exclusions:** custom conversation history, frontend path/authority inference,
automatic setup to enable Tools, rich-text editor, cleanup on view navigation.

**Validation-pass:** production Rust/DTO/DOM checks E03/E07 resolve the correct file
and moved run directory, reject foreign/stale launch, handle absent/non-Git context
without provisioning, and keep Tools reachable in every view including no-context
Draft. Failure/view switches retain terminal nodes/attachment counts and notes
roots. Real IPC/OS/PTY launch, focus and form presentation are separate T12 checks.

## T11 — Historical migration and bounded legacy cleanup

**Boundary:** production historical conversion and exact legacy artifact unlink/
cleanup, using T01 admission/T02 backup/T04 bootstrap; not future-run cleanup.

**Inputs:** R02/R03; [migration scope](idea-first-project-mgr-proposal.md#single-release-migration-and-retained-scope),
[mapping cases](idea-first-implementation-readiness.md#concrete-mapping-cases-for-review),
[required mapping](idea-first-implementation-readiness.md#required-mapping-not-yet-executed);
historical SQL migrations/archive helper, T01 admission, T02 backup, T03 transition,
T04 bootstrap/contexts and production store services.

**Owned deliverables:**

- Separate inventory/review, verified backup, schema evolution, journaled product
  conversion and cleanup entry points implementing the linked mapping. T01 gates
  both GUI/adapter before side-effecting open/legacy workers. Determine eligibility
  from original associations; reuse T04 for reviewed originally repo-free targets.
- Historical retention representation resolving migration19's Workspace FK
  `RESTRICT` with FKs enforced and snapshots retained; independent mapping/cleanup
  journals surviving owner unlink. No disabling constraints or deleting archives.
- Canonical-reference conversion before alias retirement and exact retention/
  ownership/active-use manifest, backed up outside cleanup targets. Legacy cleanup
  preserves **all actual repos/checkouts/worktrees**, `Repositories/`, native history
  and ambiguous user files; remove only aliases themselves/proven obsolete artifacts.
  T07's separately authorized future-run tree removal is not this operation.
- Restartable conversion/unlink recovery, separate-destination restore verification,
  production preview/error/recovery UI/DTOs and operational guide. Update migration/
  workflow/UX docs and matrix.

**Exclusions:** live migration during coding, whole-root deletion, any actual legacy
repository/worktree deletion, native conversation deletion, ticket seeding,
automatic resumption/model calls, multi-repo conversion or legacy view.

**Validation-pass:** E11's historical file-backed databases and real Git/filesystem
fixtures upgrade through production paths with zero tickets/runs/approvals/prompts,
exact preserved IDs/paths/provenance and unchanged retained file/ref/native-history
invariants. Archive references survive excluded owner removal. Independent crashes
after backup/schema/init/commit/unlink/alias removal recover once, with journals
intact; backup/identity/collision/changed-target failures reject before unsafe
effects and unknown ownership/activity defers cleanup. Reopen/restore verifies
coherent data and authority. Live rollout remains separately authorized.

## T12 — Complete-release integration and executable E2E evaluation

**Boundary/outcome:** own integration of all preceding tasks into one usable
release and evaluate the entire product workflow, recovery and migration. Passing
individual tasks is necessary but insufficient. This task owns repairing in-scope
integration gaps, not merely collecting unit-test counts.

**Inputs:** C01–C16, R01–R09, every task's actual evidence,
[directional scenarios](idea-first-project-mgr-proposal.md#directional-acceptance-scenarios),
[protocol acceptance gates](ticket-session-protocol-proposal.md#acceptance-gates-before-claiming-this-protocol-works),
current integration matrix and native GUI-testing policy.

**Deliverables:** completed runner/scenarios below; staged relocatable runtime;
sanitized per-scenario evidence and aggregate release report; documented recovery/
rollout/fixture cleanup; updated UX/workflow/runtime/storage/command specifications
and integration matrix; completed manual native verification packet and result.
No release pass while a required scenario is skipped, a mechanism is substituted
silently, or manual native acceptance is still unrecorded.

### Evaluation layers and executable contract

These are **new proposed deliverables**, not existing commands. T01 supplies only
the minimal admission/configuration seams needed for implementation; defer runner
and cross-feature fixture expansion until the workflows exist. T12 owns the complete
contract and execution from the repository root. The native-launch command is a
later human-authorized acceptance step, not permission to run GUI E2E now:

```sh
node app/scripts/idea-first-e2e.mjs prepare --root "$RUN" --opencode-bin "$OC" --app-bin "$APP" --adapter-bin "$ADAPTER" --plugin-dir "$PLUGIN"
node app/scripts/idea-first-e2e.mjs run --root "$RUN" --suite deterministic
node app/scripts/idea-first-e2e.mjs run --root "$RUN" --suite installed
node app/scripts/idea-first-e2e.mjs launch-native --root "$RUN"
node app/scripts/idea-first-e2e.mjs verify --root "$RUN"
node app/scripts/idea-first-e2e.mjs cleanup --root "$RUN" --retain-evidence
```

Before invoking these commands, set `RUN` to a new empty absolute directory under
`/tmp/opencode/`, `OC` to the resolved installed executable, and `APP`, `ADAPTER`,
`PLUGIN` to absolute paths in T05/T06's staged distribution. `prepare` accepts only
an empty owned root, validates inputs, copies/relocates distribution assets into
the fixture installation and records their hashes/version. Re-running preparation
cannot overwrite a previous run. `--help` documents exact options and exits.

Runner requirements:

- `prepare` creates private app/home/config/data/ticket/repository/service paths,
  a fixture ownership manifest, input catalog and evidence directory; starts no
  service/provider. Check effective production app config and private OpenCode
  discovery/auth before any process starts. There is no fallback to default user
  paths/service. Preserve unrelated normal CLI/live-app operation.
- `deterministic` runs production core/adapter/command and browser-composition
  scenarios with isolated SQLite/Git/files and bounded scripted external effects.
  No installed OpenCode or provider starts implicitly. A browser command fixture
  is explicitly labeled presentation-only. Use shared small fixtures, not a
  second implementation of production workflows.
- `installed` explicitly starts only fixture-owned OpenCode plus loopback synthetic
  provider, with private discovery/config/auth and production packaged plugin and
  adapter. Exercise actual native tools/Code Mode/subagents; synthetic provider
  scripts control calls/barriers but do not replace native executors or Rust
  authority. Pin/report executable version and capability checks. Give every wait
  a deadline and own/reap all fixture children, including failure paths.
- `launch-native` uses the relocated production app and its explicit isolated
  `--app-config`; launches no mock backend. It supplies the manual checklist and
  scenario IDs and enables real WebView IPC/PTY/TUI interaction with the fixture
  service/provider. If the normal user-owned runtime prevents a separate isolated
  app instance, fail with a supported isolation instruction rather than stopping
  it. Provide a scoped instance-identity seam if required; do not weaken ordinary
  single-instance behavior globally.
- `verify` checks scenario results, evidence provenance, backup/hash assertions,
  no duplicate effects, and manual result records. Exit nonzero for failure,
  missing required evidence, skipped gate or incompatible artifact versions. A
  native checklist may remain pending, but aggregate release status then cannot
  be passed. Deterministic/installed/native/provider results remain separate.
- `cleanup` verifies manifest ownership/process start identity, detaches/stops only
  fixture clients/services/provider/children and releases fixture resources. Keep
  evidence by default. It must neither signal the normal service nor recurse over
  arbitrary paths. Unknown ownership or outside-root targets stop cleanup visibly.

### Isolated inputs and retained evidence

Prepare fresh stores plus historical fixtures through supported old migrations:

- Ten synthetic authored ideas, an unassigned Draft with no context, tickets A/B
  sharing one real temporary source repository, and a non-Git document outcome.
- New existing-repo and local-repo Workspaces; migrated originally zero/single-
  repo active/completed/ambiguous Workspaces with notes/conversations; excluded
  multi-repo Workspace with archive references. Keep Quick Requests separate.
- Real fixture source commits, dirty/untracked source files, nested guidance that
  requests native isolation, a distinct destination guidance revision, aliased
  paths, retained nested/elsewhere repos and worktrees, local research-like refs,
  modified generated files and ambiguous user files. Fixture Git identity is
  explicitly configured only inside fixture scope; include a missing-identity case.
- An installed fixture service with known exact owner/child/history identities;
  seeded native history remains OpenCode-owned. For missing replay, use current
  native state without requiring retained historical event payloads.
- Bounded fault controls for operation phases, adapter launch/store failures,
  event disconnect/reload and native startup failure.
  Fault injection substitutes only the chosen failure boundary, not the workflow.

Retain one machine-readable result per scenario with layer, artifact/CLI versions,
step outcomes, IDs/generations/revisions, safe canonical paths/refs, operation
counts, sanitized status/error categories, observed ordering, retained-file/ref
hashes and recovery verdict. Retain approved synthetic ticket/backup manifests
where needed, not raw provider requests, prompts, credentials, transcripts or full
native tool payloads. Native screenshots/checklists must use synthetic content
and be reviewed before inclusion. Keep private service credentials/config and
OpenCode's own conversation database outside exported evidence. Record child
process ownership/cleanup results without command lines containing secrets.

### Full-release scenarios

Run E01–E12 from clean fixtures; independent failure cases must be separately
selectable by the runner's documented `--scenario E##` option. The full suites
still run all applicable cases. Native steps below run through `launch-native`;
automation may drive APIs/DOM, but cannot claim native visual/TUI acceptance.

#### E01 — Capture, organize and externally edit without setup

1. With OpenCode unavailable, use production capture to save the ten ideas with
   no Workspace/repo/model/session; inspect the real ticket home and management
   records. Expect Draft IDs in unassigned storage and no Git/session effects.
2. Through the real organization UI, rank/filter/tag/link dependencies, move an
   idea into a Workspace and rename it. Expect stable identity, correct current
   indexes, no run or approval, and no execution triggered by selection.
3. Exercise revision-checked managed updates and pending recovery. Verify scope invalidation and absence of fabricated approval.
4. Rebuild derived indexes/reopen. Compare canonical file hashes/IDs, list results
   and absence of provisioning/prompt operations. Retain conflict/order assertions.

#### E02 — Workspace creation, repository reuse and zero-ticket notes

1. Create a Workspace linked to the dirty fixture checkout. Expect that exact
   repo/branch/files, zero tickets/sessions, no clone, worktree, wrapper or symlink.
2. Create a Workspace without a selected repo; review default login namespace and
   edit the proposed informative name. Confirm local creation. Expect ordinary
   `<configured repos dir>/<username>/<reviewed name>`, `main`, one empty initial
   commit, zero project files/remotes and no automatic notes folder/ticket/session.
3. Run missing-identity, occupied-directory, post-init/pre-commit interruption and
   post-commit/lost-receipt variants. Correct/retry through production service.
   Expect actionable safe failure or exactly the original verified repo, never
   fabricated identity/global edits/duplicate repo/adoption of colliding user files.
4. Explicitly register new/retained repos under the configured root. Verify narrow
   discovery safety still rejects unsafe/soft-deleted identities appropriately.
   Open retained non-Git Notes and Conversations with zero tickets; reopen the
   selected destination. Expect original files/session cwd unchanged and future
   conversation context at the new linked repo. Retain path/Git/selection evidence.

#### E03 — Non-Git outcome and Workspace conversation

1. Start a managed Workspace conversation with no active ticket, read the retained
   notes, and perform explicitly requested bounded notes maintenance. Expect the
   workspace skill/context, no ticket/run/scope receipt or Git prerequisite.
2. Explicitly capture/bind a notes ticket. Discuss, approve its complete plan,
   execute against the existing non-Git document directory, request review and
   accept/deliver using document-appropriate obligations.
3. Expect the same file roots, ticket lifecycle/receipts, no branch/worktree/merge
   requirement and no auto move into the new local repo. Verify Notes access and
   Tools target labels with no-context and non-Git states. Retain IDs/hashes, not
   copied conversation content.

#### E04 — Discussion to approved native execution and delivery

The installed suite scripts the synthetic provider's calls. It proves real native
execution/interception and actual instruction/skill attachment, **not** that a
model chooses to read and follow a nested reference. The separate authorized
provider/native check below owns that behavioral proof. Tracking in both cases
must work independently of model narration.

1. Select Draft A and Discuss in the existing checkout. Expect explicit bound
   context/entry skill before first primary request, Draft status, unchanged
   source branch/files and no implementation tree. Attempt controlled native
   provisioning and controlled source edits before approval/begin; expect rejection
   and unchanged Git/files, with unrestricted out-of-band capabilities labeled.
2. Request scope approval from the same conversation. Answer the actual session
   form to approve the whole plan. Expect registered revision-bound Rust receipt,
   one Ready transition and waiting-tool continuation. Begin the run; expect a
   committed claim rather than authority from an admitted/pending response.
3. In the installed fixture, script the calls representing nested-reference reading
   and native creation inside Code Mode, omitting any reporting call. Move the same
   owner session into the returned context. Expect one tree/operation, correct
   Git/common-dir attribution and applied move readback; inspect actual destination
   instruction attachment/differences. No app tree is provisioned in parallel and
   no dirty guidance is silently copied. A scripted read is not model adherence.
4. Implement a synthetic fixture change, delegate required validation through E05,
   and checkpoint actual evidence. Expect current source/run context in Changes.
   No implementation-task boundary requests another scope approval.
5. Request Review, follow E06's reject/fix/accept cycle, and perform only fixture
   policy-authorized local delivery. Test delivery failure before success. Expect
   Review with the precise pending obligation on failure; Done only after current
   acceptance, verified delivery and committed finish. No push occurs. Retain IDs,
   native operation counts, context/Git facts, receipt and delivery assertions.

#### E05 — Concurrency, native children and role/context safety

1. Run tickets A/B concurrently in the same repository, including repeated inner
   Code Mode creates with a shared native outer call ID. Create another tree via
   out-of-band fixture Git. Expect distinct invocation-local operation IDs and
   correct A/B associations; the external tree remains discovered/unassigned.
2. Register bounded assignments and dispatch foreground and background native
   subagents; reuse one. Pause before their first primary requests. Expect exact
   runtime-child binding/context and explicit worker guidance before dispatch.
3. Try malformed/stale/duplicate dispatch claims, worker self-approval/finish and
   cross-ticket mutation. Change GUI selection and attempt parent rebind while
   work is active; reconcile at a safe boundary. Expect rejection without affected
   effects, no GUI-driven rebinding and old children unable to gain new rights.
4. Move only the parent, cancel a background dispatch and reload during another
   admission. Expect actual independent child locations, retained child history
   and explicit pending/failed recovery, never guessed assignment or replacement.
5. Attempt a multi-repo execution claim. Expect release-one rejection without
   orchestration fan-out. Retain per-child admission order, role/generation checks
   and Git inventories. Native background capability failure is a release blocker.

#### E06 — Forms, checkpoints, idle and state ordering

1. With valid In-progress owner work, end a controlled turn without the required
   checkpoint. Observe real owner `session.idle`. Expect Blocked with factual
   idle-derived reason plus missing-checkpoint diagnostic, no Review/Done inference.
2. Resume under current approval. Expect only the idle-derived block cleared.
   Separately retain an explicit blocker; owner activity does not clear it.
3. Inject/reconcile duplicate, stale, old-binding and subagent idle observations,
   and idle after Review/Done. Expect no newer state overwritten. Disconnect the
   collector without idle; expect unavailable/stale activity, not Blocked.
4. Exercise scope form revisions/cancel/stale reply, lost reply acknowledgement
   and waiting-tool reconnect. Request Review; answer Request changes, correct
   the same approved outcome, request Review again and Accept result. Expect one
   committed decision per valid request, no acceptance for changed result and no
   per-task approval loop. Retain forms' IDs/states/receipt references, not prompts.

#### E07 — Every ticket view, Tools and real command boundaries

1. Open no-context Draft, running and review tickets; visit Overview/Conversation/
   Changes and open Tools in each. Expect reachable document editor/folder actions
   throughout, with directory/script actions labeled or unavailable appropriately.
2. In native isolated app, invoke file editor/folder and shell/script actions.
   Verify actual canonical ticket file versus current verified execution context;
   no unrelated Workspace path, silent provisioning or restarted conversation.
   Use a fixture editor executable to record only safe file identity when needed.
3. Move the owner natively, refresh Changes/Tools, then remove a fixture execution
   context externally. Expect correct readback/verified new target or explicit
   unavailable recovery, retained ticket/history and no automatic tree recreation.
4. Switch tickets while reads/actions are delayed; return to the original terminal.
   Expect no stale results/foreign launch, stable terminal and correct pending
   input/child health. Retain production command/DTO and native IPC results;
   browser composition alone cannot satisfy this case's IPC/launch observations.

#### E08 — Relocated package, GUI quit/reopen and Quick Request lifetime

1. Use only the relocated distribution, private config and a cwd outside the
   source tree. Start owner and background native child work paused at bounded
   fixture barriers; record service identity and exact session IDs/generations.
2. Quit the actual isolated GUI through its normal Quit path, not merely hide it.
   Release a provider/tool barrier so the owner/child execute an attributable
   operation/checkpoint and then owner idle while the GUI is absent. Expect the
   same service/children/plugin alive and Rust ticket updates committed without
   a GUI process. Shell/tool PTYs follow their separate declared ownership.
3. Reopen the relocated app, attach same native sessions and inspect live state.
   Expect no replacement conversation, duplicate initial prompt, worktree or run;
   current Markdown/operations/idle block match GUI-closed progress. Continue the
   existing child and owner through the terminal.
4. Repeat shared-service lifetime with an unchanged Quick Request in flight.
   Expect same request/session/original-prompt semantics and continued execution.
   Retain service/process/session identity and operation/initial-prompt counts,
   without saving prompt content. Actual native quit/reopen remains manual even
   if a nonvisual process-lifetime runner also passes.

#### E09 — Uncertain native effects and integration outage

1. Inject startup-command failure after real native tree creation; separately
   interrupt after creation before result/final hook and lose adapter result
   acknowledgement. Reopen/retry through production reconciliation. Expect retained
   single resource and uncertain/verified state as justified, never blind create.
2. Make adapter/store unavailable before a controlled effect, then after an intent
   or external effect. Expect pre-effect rejection or durable uncertainty, named
   integration failure and same-session recovery; no falsely acknowledged tracking.
3. Reload/remove/restore fixture plugin and disconnect event collection with no
   retained replay. Expect durable links survive, visible accepted degraded mode
   while absent, and reconciliation from current facts on repair. Do not claim
   plugin removal prevented native execution.
4. Try concurrent/foreign-target and delayed moves, unavailable inventory, removed
   child context and cleanup with dirty/untracked/active/unknown usage. Expect
   explicit discrepancies/deferred cleanup, not authority from names/idle history.
   Retain phase transitions, before/after inventories and retry effect counts.

#### E10 — Ticket transaction interruption and coherent restore

1. Interrupt real production writes at stage/intent/file/finalization/response
   boundaries; vary current scope/binding revocation before recovery. Reopen using
   GUI and one-shot adapter entry points. Expect one committed result or visible
   unresolved conflict, never authority from pending bytes or stale receipts.
2. Test corrupt/missing stage, invalid Markdown,
   duplicated ID and unavailable ticket home. Expect retained readable content,
   blocked unsafe writes, actionable reconciliation and no fabricated authority.
3. Take coherent backup while cooperating writes run;
   verify hashes or reject/retry the inconsistent generation. Restore into a fresh
   isolated destination. Expect matching canonical Markdown, operational links,
   pending operations and valid receipts. DB-only, mismatched, corrupt and missing-
   authority restores cannot resume managed work or guess rights.
4. Retain backup manifests, sanitized recovery assertions and file hashes. A
   process-crash pass is not labeled power-loss proof.

#### E11 — Complete historical migration and retained-resource cleanup

1. Run inventory on historical fixture before side-effecting store open/worker
   startup. Review eligibility, proposed local repo names/paths and exact retain/
   unlink/artifact lists. Take/verify backup outside cleanup targets. Expect no
   earlier schema/file cleanup effects or model requests.
2. Execute production migration for original zero/single-repo active/completed/
   ambiguous Workspaces, notes and conversations. Expect same eligible Workspace
   IDs/tags/provenance, zero tickets/runs/approvals, old files/session cwd preserved
   and exactly one new local repo for each originally repo-free Workspace.
3. Unlink excluded multi-repo owner records with archive FKs present. Expect
   historical snapshots retained in their new retention representation; no legacy
   UI, chosen-single-repo conversion or native history deletion. Canonical retained
   paths are saved before only alias entries/proven obsolete artifacts are removed.
4. Verify retained actual repo/worktree/common `.git` contents and local refs inside
   and outside old homes/root, active checkout, nested repo, modified artifacts,
   ambiguous files and `Repositories/`. No parent containing retained material is
   removed. Active/unknown usage safely defers only affected cleanup.
5. Independently interrupt after backup/schema/init/commit/record unlink/alias
   removal; retry/reopen through production GUI/adapter admission. Expect durable
   target manifest survives owner removal, no duplicate repo, no widened cleanup
   and no prompt resend. Missing identity/collision/backup failure reject safely.
6. Restore verified pre-upgrade snapshot into a separate isolated destination and
   compare history/path/file/ref invariants. Retain manifests, phase/effect counts,
   hashes and OpenCode-native history identity/count checks, not transcript copies.

#### E12 — Quick Requests and complete-product regression

1. Through production UI/commands create a Quick Request with a synthetic original
   prompt and explicit directory; exercise list/search/recent cutoff/open/follow-up/
   navigation/reopen/delete confirmation and cancellation. Check the existing
   SQLite prompt exception remains request-linked and no Markdown ticket appears.
2. Expect exact original send once, same native session on follow-up/reopen, no
   ticket approval loop, unchanged cutoff/history behavior, deletion of app record/
   prompt link only, and retained native conversation. Cover failure-before-send
   and recoverable startup error without copying prompt text into evidence/logs.
3. Run fresh applicable broader suites and builds; audit command inventories,
   capabilities, architecture boundaries, docs/UX terminology and every coverage
   row. Historical failures are not waived. Classify and resolve in-scope failures;
   escalate any consequential scope conflict rather than claiming release success.

### Manual native terminal/Wayland and provider acceptance

Use `launch-native`'s private fixture setup, never the user's running development
app or data. Record OS/display/WebView/OpenCode/artifact versions, scenario IDs,
actual observations and pass/fail. Human checks are mandatory for:

1. Real Wayland launch/no-selection, navigation, modal/forms, compact/wide/narrow
   workbench layout and keyboard reachability; notes/zero-ticket destinations.
2. Real PTY/TUI render/input/resize/replay, stable terminal across ticket views,
   Tools/readers and child inspection; no unintended focus theft or duplicate
   attachment. Native form presentation and answer/continuation for E04/E06.
3. Actual canonical ticket editor/folder handoff, execution shell/script target,
   Changes after move/missing context and retained notes, including failure UX.
4. Window hide/show versus full tray Quit, E08 ongoing owner/background child/plugin
   progress while GUI absent, same-session reattachment and continued input.
   Confirm tool shell PTY behavior separately; Chromium is not native acceptance.
5. Migration preview/error/recovery UI with isolated historical data, retained
   completed provenance and no forced ticket/legacy multi-repo destination.

After deterministic and installed synthetic-provider checks, perform a separately
authorized **external-provider manual check** using the isolated app/service and
a user-selected configured provider/model. Verify a real model follows loaded
guidance, uses the registered form/work tools, executes/delegates and reports
review evidence. Specifically rerun E04 with a real model: supply the approved
fixture work and repository guidance containing the nested reference, then observe
the model read that reference and invoke native worktree creation inside Code Mode
without a project-mgr reporting call. Verify the single attributed tree through
the production bridge/Rust store, independently of the model's account. Retain
sanitized read/tool provenance and operation counts, distinguishing model choice
from the installed suite's scripted pipeline. Record observed adherence/limitations
without provider request or prompt contents. Obtain permission before credential
access or billable calls;
an unavailable/unrun required provider check is reported as pending, not inferred
from synthetic scripts. Provider variation cannot excuse failed deterministic
authority. No provider credentials are installed by the test runner.

### Existing commands and final pass criteria

The following commands were verified from source during planning, **not executed**.
Run fresh applicable checks during implementation and record exact outcomes:

```sh
npm test --prefix app
npm run build --prefix app
npm run test:browser --prefix app
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
cargo test --manifest-path app/src-tauri/Cargo.toml --lib
cargo test --manifest-path app/src-tauri/Cargo.toml --test opencode_cli_contract -- --nocapture
cargo test --manifest-path app/src-tauri/Cargo.toml
npm run tauri:build --prefix app
git diff --check
```

The default frontend runner excludes installed model-loader/browser suites but
does run Rust wire harnesses. Full Cargo includes installed OpenCode tests; run it
only after their private isolation is established in T03. Keep an explicit
deterministic command list as tests evolve; do not add installed-service/provider
calls to a default safe runner. Production builds stage artifacts; they do not
establish launch, packaging, WebView IPC, PTY or native acceptance. Preserve the
live script/runtime and avoid port collisions with fixture browser servers.

**Release pass requires:** every C01–C13 outcome mapped to passing actual evidence;
E01–E12 complete in their applicable layers;
production IPC and relocated GUI-closed integration proven; historical conversion/
cleanup/restore invariants passed; fresh applicable suites/builds accounted for;
manual native and authorized provider results recorded; all in-scope integration
defects fixed and rerun; documentation matches implemented behavior. Required
unrun/failed checks leave release incomplete. C14–C16 remain explicit boundaries,
not hidden gaps or promises of stronger enforcement.

### Fixture teardown and later rollout

Run manifest-checked cleanup on success and failure. Stop/reap only fixture-owned
GUI/TUI/service/provider/adapter children and close handles; release fixture Git
resources only after their retained evidence is verified. Leave unknown targets
untouched and report them. Retain sanitized results/backups until human review;
subsequent deletion requires exact owned fixture paths, never a whole-root command.
Do not delete local research branches or original research/proposal documents.

Provide the user a separate live rollout packet: artifact/version, compatible
service requirements, safe old-runtime handoff, inventory/retention preview,
proposed repo names, backup verification, recovery/restore instructions, expected
deferrals, and explicit confirmation boundary. Isolated acceptance does not itself
authorize or require the coding agent to run that rollout against live data.

## Safe resumption and implementation record

On resume:

1. Read this file, primary specifications and applicable instructions. Check actual
   branch/diff/untracked state and preserve unrelated work. Codesitter previously
   had no Rust index and stale/wrong-checkout frontend metadata; use only accurate
   root-specific indexes, falling back to targeted inspection instead of rebuilding
   broad indexes for convenience.
2. Verify recorded plan approval covers the next action. Follow the product-first
   execution order: a usable slice may proceed once its actual dependencies are
   ready, without waiting for unrelated task-wide acceptance. Continue ready work
   without per-task approval prompts; do not bypass a required safety gate.
3. Reconcile task status with actual production changes/evidence, pending migration
   intents, fixture ownership and known failures. A receipt/admitted API response
   is not proof of current file/context, applied effect or native acceptance.
4. Update task status, C-row proof, relevant R gate, exact commands/results,
   documentation changes, remaining manual checks and next safe action after each
   task/blocker. Keep reported/automated/native/provider evidence distinguishable.
5. Stop affected work for a failed required mechanism, new consequential scope
   conflict, uncertain cleanup ownership or unapproved live operation; record
   evidence, safe retained state and what resolves it. Continue independent ready
   work only when doing so does not assume the blocked decision is solved.

| Record | Current value |
|---|---|
| Approval reference/date | User implementation request, 2026-11-07; full replacement, delegated implementation and integration testing; explicit migration requirements retained |
| Completed tasks / evidence | None |
| In-progress task | T01/T02/T09 implementation in isolated worktree `/home/derekhawker/OpenCode Projects/Repositories/Worktrees/project-mgr-idea-first-implementation`. Preserve the user-owned development runtime. |
| Implementation blockers | T03 awaits T01 configuration/admission; exact binding integration also needs T05. The latest frontend run has 27 failures and the Rust baseline had format differences. The working checkout is watched by a live Tauri process; applying Rust changes there may restart it and requires an agreed safe runtime window. |
| Known unvalidated paths | Production mutation/authority/adapter/plugin/forms/idle; shared-service transition/quit; packaging; new migration/cleanup/restore; IPC/GUI/native/Wayland/provider acceptance |
| Planning validation | Revised plan passed documentation-only checks on 2026-11-07: 47 local links/anchors; 12 task fields/status/dependencies; C01–C16 coverage, R01–R09 ownership/gates, E01–E12 definitions; preserved runner/config/package deliverables and synthetic/real-model proof boundary; whitespace/fences. Diff whitespace check emitted no warnings. No production build/test, process/config/data operation or provider call ran. |
| Integration test preparation | Independent review confirms the proposed E01–E12 runner does not exist; current browser and CLI tests cannot establish production IPC, packaged plugin/native execution, GUI-closed lifetime, or Wayland acceptance. Private configuration and process isolation, distribution, and preceding features remain prerequisites. No tests or services were started for this review. |
| Fresh baseline (2026-11-07) | `npm test --prefix app`: failed, 264 passed / 30 failed (including contract/source assertions and workspace navigation). `npm run build --prefix app`: passed. `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check`: failed with existing differences in `lib.rs` and `management.rs`. No installed-service or native tests ran. These failures are not waived. |
| Post-scaffold frontend run | `npm test --prefix app`: 268 passed / 30 failed, confirming the four runner tests join the default suite; same count of baseline failures. Output retained in `/tmp/opencode/idea-first-current-frontend-tests.log`. |
| T01 partial evidence | Added fail-closed runner help and read-only root/asset preflight. The help test failed before implementation; `node --test app/test/idea-first-e2e.test.js` now passes 4 tests and is included by the default frontend scanner. The runner does not prepare fixtures or execute scenarios. Rust configuration and admission are not implemented in the watched checkout; implementation continues in the isolated worktree. |
| Runner independent test | Adversarial preflight checks passed for root symlinks, invalid assets/options and retained sentinel; executable marker was not run. Parent symlinks of asset paths are not currently rejected and non-prepare commands receive only a generic unimplemented error; resolve asset policy and command validation before implementing preparation. `strace` was unavailable. |
| T02 regression preparation | Independent worker found no canonical ticket-store entry point to test yet and did not add placeholder tests. Production service must expose isolated create/read, expected-revision mutation, preserved conflict/pending state, reopen/recovery and deterministic phase barriers. |
| T05/T08 preparation | Independent review recommends recording request and chosen form ID before creation, reconciling exact service/session/form identity, and letting only a narrow observer path submit a validated settled result to Rust. Same-service-authority clients are not independently authenticated humans. Settled-form retention, duplicate-create semantics, waiting-tool reconnection and trustworthy idle ordering remain installed-integration questions, not passed gates. |
| T05 authority preparation | Binding keys must include service/session and generation; operational runs, assignments, decision receipts and operation journals remain distinct from canonical Markdown. Retries require matching operation fingerprints; pending transitions grant no authority and recovery revalidates approval, binding and revocation. This is design preparation only, subject to the T03 identity contract. |
| T06 preparation | The current workspace-local coordinator is not the required native-child admission bridge, and disabled bundling is not a relocatable distribution. A service-side plugin and packaged, cwd-independent adapter/instructions depend on T05; foreground synthetic experiments do not establish background admission or production authority. No bridge or package has been implemented. |
| T04 preparation | Existing setup eagerly provisions managed worktrees and aliases, and Docs identifies non-Git roots ambiguously. The replacement needs direct verified association, a recoverable ownership-checked bootstrap, narrow discovery exclusions, and stable typed document source IDs. T04 remains dependent on T02; no production changes or acceptance are claimed. |
| Runtime safety | Read-only process inspection confirmed the user-owned Tauri development process is watching the primary checkout. Created detached worktree `/tmp/opencode/project-mgr-idea-first-implementation` at `4ad8c8c` for Rust work with separate Cargo artifacts; the primary checkout's uncommitted plan and runner changes are not automatically present there. No process was stopped or restarted. Reconcile exact changes before integration, which may trigger the watcher. |
| Runtime state uncertainty | A later read-only process check found neither the previously observed Tauri dev nor Vite process. Independent review confirmed neither old PID nor a matching listener is present; the cause is unknown. This session did not stop or restart the runtime. Do not assume the disappearance authorizes restarting it or accessing its data. |
| Test disk-space failure | Independent vertical-flow build failed with `No space left on device`; no vertical test ran. Two isolated Cargo targets consumed about 11.7 GiB in `/tmp`; after the baseline worker ended, ran `cargo clean --manifest-path app/src-tauri/Cargo.toml --target-dir /tmp/opencode/project-mgr-idea-first-target-baseline` to release only the Cargo artifacts created for that baseline. Preserve the separate implementation target and user runtime. Rerun safe vertical checks when space and isolation permit. |
| Resumed disk management | After isolated `/tmp` space fell below 2 GiB, verified no Cargo/rustc processes and removed only the generated default Cargo target under `/tmp/opencode/project-mgr-idea-first-implementation/app/src-tauri/target` using `cargo clean --target-dir`; the distinct implementation target, worktree source, fixtures and user runtime were preserved. The history regression can now be attempted. |
| Independent design review | T01 must account for store-absent admission, WAL-consistent historical backup and fixture instance isolation before single-instance routing. T03 must explicitly block unsafe old-server handoff and integrate service-qualified bindings after T05. T05/T08 need a concrete trusted form path and recovery ordering. T11 needs a complete FK/trigger disposition graph and pre-upgrade backup. Track legacy path retirement and existing-session adoption through integration; no silent degraded native substitute can pass release. These are in-scope implementation risks, not completed proof. |
| Baseline failure analysis | Independent rerun confirms 28 command-contract/source-spelling assertions, one component naming false positive and one outdated navigation DOM expectation. They do not independently prove a product defect; the DOM failure masks selection assertions. Review and replace obsolete assertions with applicable behavior coverage during the replacement, retaining Quick Request and inventory risks; no failures are waived. |
| Baseline test repairs | Reproduced and repaired the component-name false positive and outdated navigation indicator expectation, retaining active-workspace filtering, selection and `aria-current` assertions. `node --test app/test/frontend-organization.test.js app/test/navigation-dom.test.js`: 7 passed. Fresh `npm test --prefix app`: 271 passed / 28 failed; the command-contract failures still require review and are not waived. |
| Test repair review | Independent review found wrapped components were omitted by the replacement naming matcher. Added call-wrapped component detection and regression cases; focused organization/navigation tests pass (7). The reviewer found no loss of inventory or navigation coverage in the other repairs. Remaining source-assertion failures were mapped to retained Quick Request risks and replacement Workspace behavior for later migration, not blanket deletion. |
| Remaining frontend failures review | Terra identified the Quick Request confirm-disabled source assertion as a candidate for removal because dialog/controller tests cover the state transition. Keep it open for now: the new DOM test supplies its own wiring and does not establish production `main.js` composition. Replace it when production composition or the replacement workflow demonstrates the same risk; do not waive the 27 failures. |
| Quick Request composition | A Luna worker extended the real `main.js` composition scenario with deferred create failure, duplicate-click prevention, visible error, preserved prompt and retry. Focused test passed per worker; independent Terra review is in progress before replacing the obsolete source-spelling assertion. |
| Quick Request composition review | Terra independently ran the real frontend composition test (1 passed) and confirmed the ordinary disabled-button, visible error, retained display text and successful retry. It uses a replaced browser transport and does not prove backend persistence, actual prompt delivery or partial failures. Luna is clarifying the fixture and strengthening retry assertions; keep unrelated failure cases open. |
| Quick Request retry assertion | The composition test now checks two create calls and the unchanged synthetic prompt in the retry payload; `node --test test/application-composition.test.js` passed. The failure is injected before fixture persistence, so partial backend failures and real prompt delivery remain unproven. |
| Quick Request readiness revision | Luna added production-composition coverage showing Create disabled with no directory and re-enabled when supplied, then removed the redundant source-spelling assertion; 11 focused tests passed. Model-readiness presentation is not separately exercised in that UI test. Independent Luna verification is in progress; other source-test failures remain open. |
| Quick Request readiness audit | Luna verified 11 focused tests but found model-not-ready behavior is not proven through production composition. Worker is adding that behavior or restoring the removed assertion if the risk cannot be covered. |
| Quick Request model-readiness result | Luna could not reach the review screen with an unready model using existing production wiring; controller rejection is covered but composed disabled presentation is not. The stale source assertion was restored, so its known regex failure remains visible; directory-readiness composition coverage remains. Focused composition/controller tests passed 5/5. |
| Quick Request regression preparation | Added production dialog/controller DOM coverage for duplicate confirmation, visible failure, original-prompt retention and retry; `node --test test/workbench-ui-dom.test.js` from `app/`: 6 passed. The creation flow is stubbed, so this is not Tauri, native or E12 E2E proof. |
| Resumption and model selection | Following the usage-limit interruption, the user requested Luna 6.1 implementation workers and Terra for other workers. The model catalog has no Luna 6.1; the user selected available GPT-6 Luna for implementation and GPT-6.1 Terra for reviews/tests. Independent resumption review confirmed both uncommitted worktrees and the watched runtime; no task was complete. The final pre-interruption frontend run was 273 passed / 27 failed. |
| Updated worker instruction | User subsequently requested GPT-6 Luna for all subagents, including testing and reviews, with GPT-6.1 Terra reserved only for blocker research. The harness exposes no session-compaction tool; this handoff is the durable resumption record. |
| Post-compaction resumption | User reaffirmed the approved full replacement and Luna task/testing workers, reserving Terra for blocker research. Luna reconciliation confirmed the separate uncommitted worktrees and open T01 gates. Workers are addressing fixture ownership and portability, preparing app-only admission tests, reviewing a frontend assertion, and assessing strict runner record validation; none constitutes task completion. |
| Resumed worker allocation | Luna workers own isolated T01 GUI-admission work and the primary checkout's runner scaffold. Terra review owns native/WebView fixture isolation. These are in progress, not completed tasks; focused integration testing follows their results. |
| Resumed runner scaffold | Added versioned declarations for fixture ownership and evidence, plus operational argument validation; all commands still fail closed and write no fixture. `node --test test/idea-first-e2e.test.js` from `app/`: 6 passed. Independent Terra review is in progress; preparation and scenarios do not exist yet. |
| Runner independent review | Terra confirmed fail-closed behavior and identified missing operational-root containment/ownership validation, asset-ancestor symlink checks, scenario range validation and `cleanup --retain-evidence` parsing. Ownership/evidence objects are declarations, not validators. A Luna worker is hardening preflight; no operation may be enabled until real ownership and evidence validation exist. |
| Runner re-review | Existing operational roots and asset symlink ancestors are now checked. Independent retest found E13–E99 accepted, flag ordering/value errors, and tests that accidentally failed at nonexistent-root validation before exercising arguments. All operations remain disabled; a worker is fixing the parser and tests. |
| Runner parser revision | Parser now accepts only E01–E12 and treats `--retain-evidence` as an order-independent flag; tests use existing isolated roots to avoid masking argument failures. `node --test test/idea-first-e2e.test.js` from `app/`: 8 passed. Root path checks do not establish manifest ownership; operations remain disabled. Independent retest is in progress. |
| Runner parser independent retest | Terra confirmed E01/E12 accepted to the disabled-operation boundary, E13/E99 rejected, and flag ordering/value/duplicate checks behave correctly. Eight focused tests passed and the test root/sentinel remained unchanged. This does not prove ownership, fixture preparation or E2E. |
| Runner asset boundary revision | Luna added rejection of filesystem-root assets and fixture/asset overlap; 9 focused tests passed. A Terra tester is checking both overlap directions. The runner still cannot prepare a fixture or execute scenarios. |
| Runner asset independent test | Terra verified filesystem root rejection and equal/ancestor/descendant asset overlap rejection; a valid disjoint sibling reached the disabled-operation boundary. The root remained empty and assets unchanged. Nine focused tests passed; this is preflight evidence only. |
| Runner schema blocker | Luna found the existing ownership/evidence declarations do not specify nested fields, formats or compatibility and did not invent validators. Terra blocker research is defining a minimal interoperable contract; structural validity must not be represented as proof of fixture ownership. Operational commands remain disabled. |
| Runner schema blocker revision | Terra identified the missing schema as in-scope work: keep the Rust fixture manifest and marker fields exact, and use separate versioned runner inventory/evidence records. Marker/schema validity and hashes are not authority or provenance; safe creation and cleanup remain separate gates. Luna is implementing the narrow record-validation slice with commands still disabled. |
| Runner record-validation slice | Luna reports test-first structural validators for fixture manifest/markers and bounded evidence, with 12 focused tests passing. Inventory is not yet defined and cross-language path behavior needs testing. All operational commands remain disabled; independent Luna audit is underway. |
| Runner validator audit | Luna independently passed 12 Node tests and confirmed tested commands remain fail-closed; validators accept parsed objects and do not check real paths, bytes or ownership. It identified loose run IDs, duplicate artifact paths and provisional metadata; Rust parity review is being repeated against the separate isolated worktree. |
| Runner Rust parity audit | Luna found JS counts run-ID UTF-16 units where Rust uses UTF-8 bytes, lacks Rust's 65,536-byte manifest/marker cap, and applies stricter textual normalization. JS validates parsed objects, not duplicate raw JSON keys. A worker is correcting bounded length differences; raw decoding and filesystem ownership remain separate. |
| Runner parity revision | Luna reports red/green fixes for UTF-8 run-ID length, serialized manifest/marker limits and duplicate evidence artifact paths; 13 focused tests passed. Serialized-object size is not raw-input size, duplicate raw JSON keys are not detected, and JS path normalization remains stricter. Independent retest is underway. |
| Runner parity independent verification | Luna independently passed 13 focused tests, confirming UTF-8 byte lengths, serialized-object limits, duplicate artifact rejection and disabled operational paths. Raw-input parsing/size, actual artifact hashes, filesystem identity and ownership are not validated. |
| Runner preparation foundation | Luna aligned manifest validation with one shared WebView data/cache directory and reports 14 focused tests passing. Preparation rejects existing roots and remains disabled until exclusive creation and partial-failure cleanup authority are established. Independent review is underway; no fixture creation or release acceptance is claimed. |
| Runner preparation independent review | Luna passed 14 focused tests and confirmed no successful creation or failure cleanup is implemented. Preflight pathname checks alone cannot establish safe exclusive ownership under replacement races. Terra blocker research is specifying fd-relative creation and partial-failure handling; the runner remains disabled. |
| Runner preparation blocker revision | Terra proposes a Linux Rust helper using a trusted pinned parent, exclusive `mkdirat`, root-relative exclusive creation and one fresh namespace per root; partial or killed preparations are retained, never auto-deleted or adopted. Asset-copy stability and future cleanup need separate proof. A Luna worker is implementing the bounded helper and tests; runner operations remain disabled pending integration. |
| Runner helper adapter | Luna added an exported subprocess adapter with an explicit helper path, ownership/path checks and timeout/reaping; 17 runner tests reportedly pass, including an isolated production-helper preparation probe. CLI operations remain disabled and no signature or asset-staging proof is claimed. Independent safety audit is underway. |
| Runner helper adapter audit | Luna identified helper-ancestor/check-to-spawn substitution, inherited environment, unowned descendants and acceptance of arbitrary zero-exit helpers as prepared. The CLI is still disabled but the exported adapter executes helpers; worker is disabling that seam pending proof. Terra blocker research will propose safe execution and ownership; do not rely on owner or hash alone as provenance. |
| Runner helper adapter disabled | Luna disabled the exported execution seam and added no-spawn/no-mutation regressions; 15 focused runner tests passed. No executable provenance, process-tree containment or verified helper success is claimed. |
| Runner execution blocker revision | Terra recommends a directly invoked trusted Rust evaluation launcher calling the creation helper in-process, with `fixture-created` distinct from T12 `prepared`, explicit sanitized child environments, verified bootstrap provenance and independently established process-tree containment. A Luna worker is implementing only the bounded no-child fixture-created path; Node execution remains disabled. Cgroups/native/process cleanup and trusted bootstrap remain separate gates. |
| Rust fixture-created launcher | Luna reports limiting the isolated `fixture-prepare` executable to fresh roots under `/tmp/opencode`, validating generated records through production admission in-process and returning `fixture-created`, never `prepared`. Focused process tests passed with child deadlines. No asset staging, child launch, cleanup or GUI is implemented; independent audit is underway and bootstrap provenance remains external. |
| Rust launcher independent audit | Luna verified fd-relative creation and production status admission and ran fixture-prepare tests (2 passed). Three GUI rejection tests then exposed two failures because their temp roots were outside the newly required `/tmp/opencode` boundary; worker is correcting the fixtures. This establishes neither native GUI behavior nor artifact provenance; non-Linux compilation remains untested. |
| GUI rejection fixture repair | Luna reproduced the two root-boundary failures, moved their owned temporary fixtures under `/tmp/opencode`, and reports all 3 focused process tests passing. No GUI or live service was launched. Disk space was 1.8 GB; check capacity before builds. |
| Asset-staging preparation | Luna reports 4 passing scratch-only POSIX/Python tests under the isolated worktree for pinned-copy failure scenarios and staged hashing. This is not production Rust, a defined full asset contract, or a `prepared` claim; independent review is underway. |
| Asset-staging independent review | Luna reran 4 scratch tests and confirmed their limited ordered scenarios. It found an unchecked short manifest write and no source-name replacement test. Partial outputs are deliberately retained, not cleaned up. A worker is correcting the experiment; production staging and runner enablement remain absent. |
| Asset-staging scratch revision | Luna reports looped writes and a three-byte short-write injection plus deterministic source-name replacement rejection; 6 scratch tests passed. This remains unintegrated Python, not a production staging contract or general race-safety proof. Independent review is underway. |
| Asset-staging scratch re-review | Luna independently passed the 6 tests and ad hoc zero-write/error probes; failed manifest writes can leave partial files, deliberately retained. This remains scratch evidence only. |
| T01 adapter admission slice | A Luna worker is implementing the missing headless `project-mgr-work` config/admission entry and subprocess coverage without work mutation or service startup. Adapter authority and full operation semantics remain T05. |
| T01 adapter admission implementation | Luna reports the `project-mgr-work` CLI supports only explicit absolute config and read-only `--status`, with unsupported operations failing closed. Two spawned-process tests reportedly pass, including preservation of a historical database with live WAL and no OpenCode on PATH. Independent audit is underway; T05 authority and native acceptance are not claimed. |
| T01 adapter independent audit | Luna verified source wiring and actual-binary historical live-WAL byte-preservation checks, but found spawned test processes lack deadlines. The worker is adding bounded waits/kill/reap. Auditor did not rerun tests with only 1.5 GiB free; full T01 acceptance remains open. |
| T01 adapter timeout revision | Luna added three-second child deadlines with kill/reap, but did not rerun after the edit because disk was below threshold. The isolated default target had regenerated; after checking no Cargo processes, it alone was cleaned again. Independent rerun now explicitly uses `/tmp/opencode/project-mgr-idea-first-target`. |
| T01 adapter timeout independent test | Luna independently confirmed the bounded child helper and ran both adapter tests successfully using the shared target and isolated temporary fixtures. Two existing dead-code warnings were emitted. No live services ran; T01 GUI/native gates remain open. |
| T01 integration reconciliation | Luna confirmed ordinary GUI remains disabled, app/adapter and fixture seams are split across worktrees, and actual release fixture GUI admission has not run. T01 needs focused integrated startup/fixture/adapter checks and release compile before any isolated display-backed fixture test; full staging/cleanup remain T12. A Luna tester is running safe non-GUI checks. |
| T01 integrated non-GUI validation | Independent Luna run using the isolated shared target: startup unit 24 passed; fixture preparation 2, app-only status 2, adapter status 2, startup admission 3 and GUI rejection 3 passed; release library check passed. Two dead-code warnings appeared. No GUI or live service ran; native GUI/Wayland and release fixture GUI admission remain unverified. |
| Fixture preparation helper | Luna reports isolated `fixture_prepare.rs` and tests with exclusive root-relative creation, retained partial roots and startup-loader interoperability; 27 reported tests passed. The helper is not wired into startup or the runner, does not copy assets or launch processes, and is under independent safety audit. `/tmp` has approximately 1.4 GiB free after the build; preserve existing sources and avoid large builds. |
| Fixture preparation independent audit | Luna confirmed the tests call the real startup loader but found the helper does not verify its trusted-parent assumption and can return paths inconsistent with pinned objects after parent replacement. Directory sync, late-failure/crash cases and unsupported `openat2` behavior are also unproven. Worker is revising; do not integrate the helper yet. |
| Fixture preparation safety revision | Luna reports parent owner/mode checks, created-root identity recheck, directory fsync and tests for replacement, late failure and unsupported `openat2`. These changes were initially uncompiled due to low disk space. After verifying no Cargo processes, cleaned only the isolated worktree's regenerated default target; independent review and focused tests are underway using the separate shared target. Same-user hostile renames and power-loss durability are not claimed. |
| Fixture preparation revision independent test | Luna independently passed 30 helper tests, verified deterministic pre-final-check root replacement and owner/mode checks, and found no concrete defect within the documented cooperative boundary. Existing interoperability only calls the manifest loader and discards the generated config; worker is adding actual config/admission coverage before integration. Directory fsync and same-user post-check races are not proven as power-loss or hostile-concurrency guarantees. |
| Fixture generated-config admission | Luna added a test using production config loading, GUI-admission preparation and status without launching a GUI; 31 fixture-target tests passed serially. A parallel run failed a namespace lock test, so test isolation is being repaired rather than waived. Independent review of the generated-config coverage is in progress; runner integration remains disabled. |
| Fixture generated-config independent review | Luna confirmed the test uses the actual source implementations of config/admission/status and preserves config, markers and sentinel, but imports them via `#[path]` into the test crate. It does not prove production crate wiring, executable dispatch, runner invocation or native GUI isolation. |
| Fixture test isolation revision | Luna changed the integration harness to import startup from the compiled application library rather than re-including its private tests; the fixture target passed 7 tests in both default parallel and serial runs. Competing creation coverage remains. A separate worker is implementing a narrow production helper entry and spawned-process coverage; runner operations remain disabled. |
| Fixture helper executable | Luna reports a production `fixture-prepare --root` binary and spawned-process coverage for prepare, real status admission and existing-root preservation. Focused fixture and startup tests passed; workspace-wide formatting still reports another existing test difference. No GUI, service, asset staging or cleanup ran. Independent audit is underway. The isolated worktree's stale plan copy is not the approval record; approval is recorded in this primary handoff. |
| Fixture helper executable audit | Luna found no concrete source-level defects in CLI argument handling, exclusive creation or the spawned-process preservation test. It did not rerun tests with low `/tmp` space; non-Linux compilation remains unverified. A safe targeted rerun using the shared target is being assessed. |
| Fixture executable rerun limit | Luna did not identify the implementation worker's claimed `/home` target and did not rerun; the known `/tmp/opencode/project-mgr-idea-first-target` remains separate from the isolated default target. Do not claim an independent process-test pass. A separate Luna worker is preparing fail-closed fixture GUI process tests without launching a GUI. |
| Fixture GUI process rejection | Luna reports two spawned-process tests passing for debug-build fixture GUI rejection, unchanged prepared fixture files, and conflicting/unsupported arguments. No GUI or service was launched. The debug gate occurs before fixture parsing, so malformed release GUI admission remains untested; independent review is underway. |
| Fixture GUI rejection audit | Luna independently passed both process tests and confirmed actual debug binary rejection before Tauri. The child commands lack timeouts, and tests do not cover release-mode manifest parsing. Worker is adding bounded child waits and distinct argument cases; native GUI remains untested. |
| Fixture GUI rejection test revision | Luna reports bounded child deadlines with kill/reap on timeout and added missing-value/duplicate-option cases; 3 focused tests passed. This covers debug rejection and argument parsing only, not release GUI admission. |
| Browser baseline | Independent Terra worker verified isolated loopback/PID-scoped browser sessions and ran `npm run test:browser`: 16 passed, 2 reported failed (the underlying failure is an expected padding mismatch in `app/test/ui-control-fonts.browser.test.js`). The existing port-1420 listener retained PID 304109. This is not native Tauri/Wayland acceptance; investigate rather than waive the failure. |
| Browser baseline revision | Independent review confirmed the failing subtest asserted exact computed padding rather than reachability or usability, contrary to the project testing policy. Removed that visual-preference-only subtest without changing UI styles or the surrounding behavior checks. An independent browser rerun is in progress; no native acceptance is inferred. |
| Browser baseline rerun | Independent Terra rerun of `npm run test:browser` passed 17 tests, with port 1420 retaining PID 304109. This establishes browser checks only, not native/Wayland acceptance. |
| Native fixture isolation review | A safe native fixture launch needs a release artifact with embedded verified assets, private instance namespace, explicitly fixture-owned WebView storage, and fail-closed path/service checks; dev binaries otherwise target the user's port 1420. A private bus alone does not establish ordinary desktop routing. A Luna worker is evaluating the bounded fixture path; native launch remains unproven. |
| Command inventory repair | Removed the obsolete fixed command count while retaining equality checks against both Rust registrations and command attributes. `node --test --test-name-pattern='checked-in command inventory' test/command-contract.test.js` from `app/`: 1 passed. A subsequent `npm test --prefix app` produced 272 passed / 27 failed; remaining command-contract failures are not waived. |
| T01 isolated implementation | Worker implemented preliminary Rust config/admission in the isolated worktree, with 3 focused and 170 library tests passing and a byte-preserving headless fixture check reported. Independent startup-safety review and process-level tests are in progress. Adapter admission, complete runner preparation and native instance verification remain unimplemented or unverified; T01 is not complete. |
| T01 independent verification/revision | Independent executable checks passed for empty storage, invalid configuration/no fallback, and a real SQLite database with open WAL/SHM remaining byte-identical; fake OpenCode was not invoked. GUI and instance routing were not tested. Independent review identified normal old-instance routing before admission, same-data-directory conflicting config routing, unbounded config reads/FIFO, synchronous filesystem admission, and insufficient historical GUI proof. The worker is revising those issues in isolation; missing runner/approval findings were due to the deliberate checkout split. |
| T01 revision / blocker | Revised isolated code fails closed before all GUI single-instance routing; bounded config/FIFO and one-shot status admission regressions pass (worker reported 3 integration and 5 focused tests). This is not a usable GUI admission path: instance compatibility and full-config routing remain unproven, and the persistent adapter needs bounded orchestration. Independent blocker review and testing are in progress; T01 remains incomplete. |
| T01 revision independent test | Independent focused tests passed: 3 executable integration and 5 startup unit tests, including GUI rejection before routing, FIFO rejection, simulated deadline and unchanged historical DB/WAL/SHM bytes. No GUI, actual blocked filesystem, old-owner routing, installed service or provider was tested. GUI remains disabled pending the routing solution. |
| T01 routing blocker review | The installed single-instance plugin cannot reject a forwarded mismatched configuration or establish compatibility with an old owner, and platform ownership mechanisms differ. A pre-Tauri ownership and compatibility protocol may solve this where an atomic legacy-compatible guard is proven; unknown/unsupported ownership must fail visibly, not route or stop the old app. A worker is evaluating an isolated Linux path; no native routing is claimed. |
| T01 fixture revision | Independent Terra review distinguished missing fixture contracts (in-scope implementation work) from genuine uncertainty about platform WebView profiles and normal old-owner routing. A Luna worker is implementing confined fixture configuration, manifest and lifetime ownership locking first; GUI stays disabled until an isolated runtime-created WebView and release asset path can be verified. |
| T01 fixture ownership slice | Luna reports a headless fixture manifest/config validator and exclusive admission lock in the isolated worktree, with 8 startup unit and 3 integration tests passing. GUI stays disabled. A Terra reviewer is testing path/lock/crash behavior independently; the fixture launcher, GUI/WebView isolation and lock recovery remain unvalidated. |
| T01 fixture ownership audit | Terra demonstrated overlapping fixture roots can be owned simultaneously, unlink/replacement defeats the sentinel lock, killed owners leave stale state, rejected config mismatches mutate the root, and relative fixture roots are accepted; pathname checks also retain a TOCTOU risk. A Luna worker is revising these failures with real lifetime locking and fail-closed checks. No GUI or release pass is claimed. |
| T01 ownership revision | Luna reports replacing the sentinel with a cooperative OS advisory lock on `/`, prevalidating mismatches, rejecting relative roots and pinning Linux directory handles; 11 startup unit and 3 integration tests passed. The lock serializes all cooperating fixture admissions and may have broader host interactions; Terra is independently reviewing its safety and prior failure cases. GUI and native routing remain disabled/unverified. |
| T01 ownership re-audit | Terra confirmed prior sentinel, stale lock and mismatch-mutation problems were addressed, but reproduced a root-replacement race mixing an original owner marker with replacement data. An isolated namespace probe also showed `flock("/")` contends with unrelated uses and is not universally host-wide. Luna is replacing it with a narrow fixture namespace guard and fd-relative identity checks; no safety gate is passed. |
| T01 root-race revision | Luna reports pinned Linux `openat2` traversal, namespace-scoped locks instead of `flock("/")`, and red/green root-replacement and unrelated-lock regressions. It reports 18 startup unit and 3 admission tests passed. Locking remains cooperative and abstract sockets are network-namespace scoped; non-Linux compilation, GUI and hostile filesystem isolation remain unproven. Independent Luna audit is underway. |
| T01 independent revision audit | Luna found the new unrelated-lock test itself acquires `flock("/")` on the real host and must not be rerun as written. The full status flow lacks a deterministic root-replacement interleaving, markers are checked before lock acquisition, and duplicate namespace IDs can over-contend. A worker is replacing the unsafe test and investigating the validation ordering; the ownership gate remains open. |
| T01 safer test revision | Luna reports replacing real-root locking in the test with an unrelated temporary directory, rechecking markers after namespace locks, and fd-relative ancestry regression coverage; 20 startup unit and 3 admission integration tests passed. Duplicate namespace IDs intentionally over-contend, network-namespace and cooperative-lock limits remain, and non-Linux compilation was not verified. Independent re-audit is underway. |
| T01 safer revision independent audit | Luna ran 20 safe startup unit tests and the historical live-WAL status test successfully; no test now flocks real `/`. Full status-entry root replacement during validation is not yet tested, and noncooperating mutations after checks remain outside the demonstrated contract. A Luna worker is advancing the bounded fixture GUI admission seam without enabling ordinary GUI startup. |
| T01 fixture GUI slice | Luna reports a Linux release-only fixture admission window with explicit configuration/manifest, retained namespace lock, inline admission surface and fixture WebView data path, without ordinary routing, store, runtime or workers. It reports 23 startup tests and release `cargo check --lib` passed. No GUI was launched; native profile/assets/network isolation, lock lifetime and competing-process behavior require independent verification. Ordinary GUI remains disabled. |
| T01 fixture GUI audit | Luna found the manifest's WebView cache directory is not applied and that top-level navigation filtering plus a null CSP does not prove subresource/network isolation. Source inspection supports the limited no-plugin/no-runtime path and lock lifetime, not native WebKit safety. Worker is addressing both; do not launch the fixture GUI until isolation is proven. |
| T01 WebView revision | Luna aligned fixture data/cache paths with the pinned Wry single-directory behavior and changed the inline surface to a restrictive CSP custom-protocol response. The cache regression was red before the fix; the green run was deferred for disk space. After confirming no Cargo processes, cleaned only the isolated worktree's generated default Cargo target; the separate implementation target and sources remain. Independent review/tests are underway. Native WebKit profile, CSP enforcement and process-wide network isolation remain unproven. |
| T01 WebView independent verification | Luna checked pinned Wry 0.57 uses the supplied directory for both WebKit base data and cache, confirmed entry/protocol guards by inspection, and ran 15 fixture-focused Rust tests successfully. No GUI ran; actual native WebKit behavior, CSP enforcement and network isolation remain unproven. A Luna worker is advancing runner fixture preparation without enabling unsafe operations. |
| T01 entry-race test preparation | Full status-dispatch root replacement needs a controlled synchronization seam in `lib.rs`; the prior worker scope disallowed it, so no test was added. Worker is now authorized to add the minimal test-only seam, with no release bypass, and exercise the actual shared dispatch/admission path. |
| T01 entry-race regression | Luna reports a test-only barrier in shared status dispatch/admission, deterministic root replacement after initial identity validation, and preservation checks for both trees. It went red with the second identity check removed and green restored; 24 startup tests and release library check passed. It does not spawn the OS entry point; independent Luna review is underway. |
| T01 entry-race independent review | Luna verified by inspection that the hook is test-only, dispatch uses the actual status service, and both root trees are checked; no rerun was attempted with less than 2 GiB free. The race is not a spawned-process E2E test and native GUI/routing remain unverified. |
| T01 ownership design review | Terra recommends one pre-provisioned, fixture-owned coordination namespace, a retained nonblocking OS lock, and all validation/operations relative to pinned directory descriptors with no fallback. This supports cooperative isolation only; APIs that later reopen ordinary paths, mount aliases, namespace replacement and non-cooperating processes need separate proof. Linux primitives do not establish macOS/Windows behavior. |
| T01 acceptance review | Terra identified possible non-Linux compile errors in conditional fixture code; runtime unsupported errors are insufficient if supported targets cannot compile. Recheck after the ongoing revision. Headless status was independently verified with a fake OpenCode executable not invoked and unchanged WAL fixture; actual GUI/adapter admission, backup gating, and manifest round trips remain unproven. The primary runner is separate from the isolated worktree and still only a scaffold. |
| T01 app-only status tests | Luna added isolated `tests/app_only_status_t01.rs` covering empty PATH/private home and invalid or absent configurations, reporting 2 passing tests before a subsequent unused-import cleanup. An independent Luna review and rerun are pending; GUI and migration acceptance remain unproven. |
| T01 app-only independent test | Luna independently reran both tests successfully without warnings. Children use an empty PATH, private HOME/XDG paths, no display and an invalid bus; invalid or missing configurations leave private data paths absent. This does not instrument all possible system-service access or establish GUI admission. |
| Resumed T01/T02 blockers | Luna worker could not establish a safe GUI ownership/WebView isolation path; it retained unconditional fail-closed GUI startup in the isolated worktree. Its 5 startup unit and 3 admission integration tests passed, but T01 remains incomplete. Independent review of GUI ownership remains outstanding. |
| T03 regression preparation | A Luna worker added isolated `app/src-tauri/tests/reconcile_history_limit.rs`, using a fake executable and loopback fixture to target the unsupported 500-message history limit. Terra found the first fixture always returned the first page; Luna corrected it to return the cursor-dependent second page. The intended red test is not yet verified and T03 implementation remains gated on T01. |
| T03 verified red | Independent Terra run of the corrected isolated test failed at the intended assertion: production reconciliation returned 200 messages rather than 250 because it made one history request. The private loopback fixture exited cleanly and no normal OpenCode service was started. T03 production changes remain gated on T01. |
| Latest frontend suite | `npm test --prefix app` after runner and Quick Request test additions: 277 passed / 27 failed. Remaining failures are not waived and must be resolved alongside the replacement's behavior coverage. |
| Current frontend suite | Following the ninth runner preflight test, `npm test --prefix app` reports 278 passed / 27 failed. The remaining failures remain release blockers, not skipped checks. |
| Preservation baselines | Isolated `cargo test --offline --test docs_reader_integration production_reader_loads_workspace_home_document_relative_to_workspace -- --exact` passed (1 test). A concurrent historical archive test build in the implementation worktree encountered T01's incomplete `startup.rs`; rerunning `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target-baseline cargo test --offline --manifest-path app/src-tauri/Cargo.toml --lib historical_task_rows_are_archived_before_conversion_without_touching_files` against the unchanged primary Rust source passed (1 test). Neither establishes new migration or native acceptance. |
| Parent review/validation | Read the full draft, reviewed all nine concerns against the source/specifications, corrected three stale protocol statements, and resumed the same subagent for completion and a tighter revision. Independent documentation checks passed across 10 documents and 133 local links/anchors, whitespace/fences, 12 task/dependency rows, 16 coverage items, 9 concern gates, 12 E2E scenarios and task-boundary fields. No production build/test or live operation ran. |
| Resumed implementation | User requested continuing approved non-GUI work without waiting for GUI acceptance. In the isolated worktree, added an unwired Rust capture/read/list slice for unassigned Markdown ideas: exclusive staging and hard-link publication, bounded regular-file reads, external body edits, and per-file diagnostics. Parent reran `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target cargo test --offline --lib idea_tickets::tests`: 10 passed. This is not an end-to-end feature: no command/UI, grouping, updates, operational journal, recovery, backup, or authority exists. Staging cleanup/recovery, directory replacement, cross-platform support and crash durability remain unproven; do not expose this slice as a completed safe store. |
| History pagination slice | In isolated `opencode.rs`, reconciliation requests 200-message pages and follows cursors with a repeated-cursor/page limit guard. The private loopback regression was reported red before the change (200 rather than 250 messages); parent reran `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target cargo test --offline --test reconcile_history_limit -- --nocapture`: 1 passed, with two existing fixture dead-code warnings. The scripted response does not establish installed-service cursor behavior, shared ownership, or T03 acceptance. |
| Capture staging review | Added read-only staging inspection; a parseable stage is explicitly unverified, not a recovery receipt. Parent rejected and removed a proposed recovery publisher: matching names/content cannot prove a complete staged write, and the stage can change between validation and publication. Durable intent, authority and race-safe recovery remain required before publication from staging. Parent reran `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target cargo test --offline --lib idea_tickets::tests`: 12 passed; isolated `cargo fmt -- --check` and `git diff --check` in both checkouts passed. No native GUI was run. |
| Capture publication revision | The isolated capture now publishes a synced `O_TMPFILE` inode via exclusive `linkat`, and reports directory-sync failure as an uncertain publication with its ticket ID. Parent reran the focused idea-ticket tests: 13 passed, including path substitution and sync failure; isolated formatting and diff checks passed. An interruption before the unnamed snapshot is linked can lose it; there is no durable intent or recovery yet, no platform acceptance beyond this fixture, and ancestor-directory replacement remains unproven. This library remains unwired and T02 remains incomplete. |
| Durable capture attempt | An implementation attempt produced 11 passing and 2 failing focused tests and lacked crash/retry proof. The worker removed that attempt, preserving the previous 13-test capture slice; no durable intent or recovery publisher is enabled. Stage-name/path validation, atomic intent publication, idempotence and process-interruption tests remain prerequisites. |
| Shared-service connection slice | Isolated `opencode.rs` now has an explicit authenticated loopback connection path whose teardown does not own or stop the service. Configuration rejects credentials in URLs, extra URL components and redirects; diagnostic formatting redacts the password. Parent reran `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target cargo test --offline --lib opencode::tests`: 28 passed; isolated `git diff --check` passed. The path is not wired to app startup and version metadata is not stable service identity. Existing private startup is still present; exact identity, safe legacy owner handoff, restoration and GUI-closed plugin work are unimplemented. No installed service or GUI was started. |
| Configured shared-service and terminal preparation | `AppConfig` can select a shared endpoint and protected credential file; its factory creates the shared runtime without network access, while status does not read credentials. A scripted loopback integration exercises production config, authentication, model request, error sanitization and service survival after client shutdown. Parent reran `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target cargo test --offline --test shared_service_runtime`: 2 passed; `startup::tests`: 26 passed. Shared TUI preparation now resolves a real CLI on demand rather than treating the service label as an executable; its fake-CLI regression passed per worker. Actual PTY/native use and stable service identity remain unvalidated. A build filled `/tmp`; after confirming no Cargo processes, cleaned only the isolated worktree's generated default Cargo target, preserving source and shared target. |
| Shared session restore | The isolated production restore service now reads the exact session and server-reported directory for shared connections, treats only a confirmed 404 as missing, and rejects inaccessible or unauthorized locations without replacement or prompt resend. Parent ran `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target cargo test --offline --test shared_session_restore`: 3 passed; two pre-existing fixture dead-code warnings. Tests use real store/orchestration and scripted loopback; actual Tauri PTY attachment, service-qualified identity and changed-location reconciliation remain unvalidated. Existing private-runtime restore behavior is not yet retired. |
| Old-owner handoff boundary | The shared restore path now rejects active, missing or unknown old-owner evidence; production currently always reports unknown, so **all** persisted shared restores are blocked, including sessions that should eventually be recognized as shared-owned. Parent reran shared restore: 4 passed and `opencode::tests`: 29 passed. A blocker investigation found legacy records lack the old endpoint/identity and its password is process-local; matching session IDs or idle state cannot prove transfer safety. The next integration must distinguish unresolved legacy sessions from newly created/adopted sessions using persisted, generation-checked service provenance, and establish authenticated stable service identity before allowing bound restore. Cooperative legacy handoff needs session-specific safe-boundary evidence and a journal; if unavailable, retain a blocked recovery result. The safe-boundary observation used by the integration fixture is injected, not a production receipt. Coordinate schema and authority with T05; do not claim reopen or handoff is complete. |
| Backup attempt not retained | An isolated backup attempt lacked writer coordination and initially could recursively remove a replaced destination or create a missing source DB. A revision removed those behaviors but still used pathname-based output writes vulnerable to directory replacement, and its snapshots could not establish coherent authority. The worker removed that candidate and its added dependencies. T02 backup requires coordinated writers and owned, pinned output paths; no backup/restore capability is claimed. |
| Latest capture intent slice — review pending | A Luna worker reports adding synced named capture staging, atomic bounded SHA-256 intent, read-only pending-intent inspection, and a child-process interruption test to isolated `idea_tickets.rs`. Worker reports 15 focused tests passed, formatting and diff checks passed. The user requested stopping immediately after the worker returned: these changes have **not** been reviewed or independently tested by the integration owner. No automatic recovery is claimed. Inspect failure ordering, directory ownership/races, error semantics and test evidence before relying on or extending this slice. |
| Current request constraints | Full replacement; preserve required migration and user data; at most one GPT-6 Luna implementation worker at a time; Terra only for a concrete blocker; no E2E GUI tests; continue ready non-GUI work; live migration, service changes and external-provider calls require separate authorization. GUI acceptance remains unvalidated and release incomplete. |
| Execution reset | User directed product-first vertical slices and deferred broad integration-fixture work until the relevant workflows exist. All twelve tasks and their release proofs remain in scope; no task has been completed. Focused regression and safety tests continue during implementation; GUI E2E remains prohibited and manual native acceptance unvalidated. |
| Next safe action | On resumption, reconcile both checkouts and review the latest isolated capture-intent changes. Implement safe fresh-store admission and initialization, then connect offline capture/list/reopen through production Rust commands and presentation. Keep existing stores blocked before migration/legacy workers; do not disturb the user-owned runtime. Defer broader fixtures and suites until their workflows are ready. |
| Capture-intent integration review | Reconciled both uncommitted checkouts and independently ran `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target cargo test --offline --manifest-path app/src-tauri/Cargo.toml --lib idea_tickets::tests` in the isolated worktree: 15 passed. Inspection found that successful publication retains both an intent and a staging hard link to the canonical inode. Successful captures are therefore still reported as pending or diagnostic, not finalized, and the retained stage is not an independent immutable snapshot. Inspection also enumerates intent names by pathname separately from the pinned directory and silently drops enumeration errors. Do not treat this as a safe recovery receipt or expose it as resolved recovery; directory replacement, failure ordering and idempotent recovery remain open. No GUI, provider, live migration or service operation ran. |
| Resumption safety | Both checkouts retain their existing uncommitted changes. Fresh admission remains fail-closed pending implementation; ordinary GUI startup is disabled in the isolated checkout. The active implementation worker was explicitly directed to the approved primary handoff after initially reading the stale isolated plan. `/tmp` reported approximately 840 MiB free; avoid large builds and do not remove user or unidentified artifacts. |
| Offline presentation dependency | The existing `app/src/main.js` startup eagerly initializes the model selector, scans repository roots, loads legacy navigation and starts terminal/pending-input machinery. Wiring a capture button into that startup would not satisfy offline/no-OpenCode capture: the replacement entry must avoid those eager legacy paths or defer them until explicitly needed. This is an implementation requirement, not evidence that the new UI exists. |
| Fresh capture initialization attempt | In the isolated checkout a Luna worker added `--initialize-capture`, checking the management database and three SQLite sidecars before creating `unassigned`, plus focused initialization tests. Worker reports focused admission tests and 17 capture tests passed; its binary check failed when `/tmp` filled. After confirming no Cargo/rustc processes, the integration owner cleaned only the isolated worktree's generated default Cargo target, recovering approximately 3.8 GiB; the separate shared target and all source/fixtures were retained. Review: this is not fresh-store admission: it returns `NewStoreUnavailable` after creation, records no durable fresh-store identity, does not gate later capture calls, and uses pathname checks without pinning the directory across operations. Existing-store checks are not atomic with initialization. Do not expose or count it as a safe production workflow; further implementation and focused verification are in progress. No GUI or service was launched. |
| Offline Rust capture revision | Worker added a persistent ticket-store marker, Linux pinned directory handles, a legacy-store/sidecar check before fresh capture/list, `--initialize-capture` and bounded-stdin `--capture-idea`, plus Tauri capture/list handlers registered only in the disabled legacy builder. Worker reports focused startup/input tests, an isolated CLI initialization/capture/reopen/sidecar-rejection workflow, binary `cargo check`, format and diff checks passed. Integration owner independently reran `CARGO_TARGET_DIR=/tmp/opencode/project-mgr-idea-first-target cargo test --offline --manifest-path app/src-tauri/Cargo.toml --lib idea_tickets::tests`: 19 passed, and `git diff --check` passed. This is not a delivered vertical product workflow: no accessible replacement GUI or command contract/presentation exists; commands are synchronous and must use bounded blocking orchestration. The previously recorded staging/intent defect and admission check-to-use race remain open; pinning directory handles does not serialize legacy stores appearing later. No migration, OpenCode service, provider, or GUI ran. |
| Capture presentation attempt / safety review | Worker added an isolated capture screen, frontend contracts, bounded command executor and explicit `--capture-gui`. Worker reports controller tests and Rust library/test checks passed; link failed with an `lld` bus error, frontend build was not run because isolated dependencies are absent, and no GUI ran. Integration review found the GUI uses Tauri's configured dev URL and default WebView profile, so it must fail closed until it cannot access the user's development server or profile; separate instance routing is also unvalidated. The Rust `UnassignedEntry` diagnostic is an adjacently tagged enum with a `ticket` payload containing `file_name`, while the frontend contract expects top-level camelCase `fileName` and `message`; malformed-ticket listing will fail contract validation. Controller tests mock the transport and do not cover that serialization. A worker is correcting entry safety; the DTO mismatch remains to fix and verify through the Rust/JS boundary. This screen is not yet a delivered or validated product workflow. `/tmp` was down to approximately 151 MiB; no further Cargo build was attempted. |
| Capture controller independent check | Integration owner ran `node --test test/capture-controller.test.js` in the isolated `app/`: 2 passed. These exercise a mocked invocation, not the production command contract, actual Rust serialization, DOM, GUI or native routing. |
| Capture GUI fail-closed revision | The worker removed the attempted native capture builder and made `--capture-gui` return an error before Tauri setup until bundled asset selection, dedicated WebView profile and native instance routing are established. Worker reports isolated Vite build, focused frontend contract/inventory tests, formatting and diff checks passed; dependencies were borrowed through a temporary symlink and the symlink removed. The build still contains legacy chunks; no native asset isolation, GUI or routing was tested. Capture/list handlers remain registered only in the disabled legacy builder. The diagnostic DTO mismatch remains open and is being fixed. The isolated checkout remains unintegrated with the working checkout; no release gate has passed. |
| Diagnostic contract revision | Worker changed the frontend command adapter and manifest to accept Rust's adjacently tagged diagnostic and map it for display. A shared serialized fixture is checked by a new real-store Rust test and frontend contract test. Worker reports 2 controller tests, 6 focused frontend contract tests, Vite build, formatting and diff checks passed. The Rust serialization test has not run; its proof remains pending. `/tmp` has approximately 150 MiB free while `/home` has 122 GiB; a worker is using a newly created owned build directory on `/home` for focused Rust validation rather than deleting existing artifacts. GUI remains fail-closed, and no GUI, provider or service operation ran. |
| Worktree relocation and capture progress | At the user's request, moved the isolated worktree across filesystems to `/home/derekhawker/OpenCode Projects/Repositories/Worktrees/project-mgr-idea-first-implementation` and repaired its Git worktree registration; status confirms its uncommitted files remain present. The primary checkout did not move. The worker reports the Rust diagnostic regression and focused startup/profile, frontend contract and capture-only build checks passed, and a Linux release capture GUI path with dedicated profile, isolated capture assets and profile-scoped routing was implemented in that worktree. These results and changes need integration-owner review; native WebKit/profile and D-Bus routing were not tested, and GUI acceptance remains prohibited in this session. The worker's separate Cargo artifacts are at `/home/derekhawker/.cache/project-mgr-idea-first-build-7WX8PitL`; the existing `/tmp/opencode/project-mgr-idea-first-target` remains in place and `/tmp` is still nearly full. Continue approved implementation in the relocated worktree, with the capture safety and recovery gaps still open. |
| Inbox refresh race | In the relocated worktree, added a controller regression for an Inbox list response arriving after an idea was saved. `node --test test/capture-controller.test.js` first failed because the stale response removed the saved item and selection; after invalidating stale list results on a successful save, all 3 tests passed. This is presentation behavior with mocked commands, not GUI or IPC acceptance. Review of the capture GUI entry confirms a separate embedded asset configuration and configured WebView profile; actual native isolation and D-Bus relaunch results remain unvalidated, including whether a mismatched relaunch can report its rejection to the launching process. Capture-intent recovery remains in progress. |
| Capture staging revision | Worker changed staging to a distinct inode and added a post-publication reread. Integration owner independently ran `CARGO_TARGET_DIR=/home/derekhawker/.cache/project-mgr-idea-first-build-7WX8PitL TMPDIR=/home/derekhawker/.cache/project-mgr-idea-first-build-7WX8PitL cargo test --offline --manifest-path app/src-tauri/Cargo.toml --lib idea_tickets::tests` from the relocated worktree: 21 passed, including the Rust diagnostic fixture and edit regression. Retained intents are not finalized receipts; recovery and safe retry remain unfinished. No GUI, external service or provider ran. |
| Capture UX documentation | Added `docs/ux/screen-idea-capture.md` and linked it from the relocated worktree's UX index, explicitly marking the screen and native validation as in progress and listing the broader missing release workflows. This documentation is isolated with the implementation and is not a release claim. |
| Read-only capture recovery presentation | Worker added a bounded recovery-list command and a capture-screen report of retained intent/staging state; failed saves keep form data and request a report without replaying a write. Worker reports 21 ticket-store Rust tests, 4 controller tests, 4 focused contract tests, formatting and diff checks passed. Integration owner independently reran the 4 controller tests and inspected the report: matching bytes remain labeled unverified, not authority, and artifacts are not automatically published or deleted. This is not idempotent retry or completed recovery: intents persist, incomplete publication requires reconciliation, and intent enumeration still drops individual directory-entry errors. No GUI, migration, provider, or service operation ran. Next approved product work is organizational workspace creation using an explicitly selected existing repository, while repo-free creation remains gated on safe local-repository bootstrap. |
| Recovery enumeration correction | Integration owner changed intent enumeration to return a directory-entry error instead of silently omitting the failed entry. The focused Rust ticket-store suite passed again (21 tests) using the home Cargo target; the existing tests do not inject an OS directory-iteration error. Recovery/idempotent retry remain incomplete. |
| Organizational Workspace attempt rejected in review | Worker reports a fresh-store create/list/reopen path for an explicitly selected existing repository, with 4 focused Rust tests and frontend/build checks passing. Integration-owner source review found `management::create_workspace_with_existing_repository` creates a legacy Workspace home with `ensure_regular_workspace_home` and requires the existing checkout to be on its default branch. Both contradict the approved replacement: no mandatory wrapper home and no branch switch/restriction merely for discussion or association. The new database initialization also calls legacy auto-migrating `ManagementStore::open_with_paths` before writing its ownership marker and uses pathname-based owner verification, leaving creation/interruption and replacement races unresolved. Do not treat this Workspace slice as safe or complete; worker is correcting the model and store boundary. No user data or GUI was touched. |
| Organizational presentation review | The provisional Workspace screen renders the legacy `homePath` and assumes a branch for every association; those fields must follow the corrected organizational DTO rather than implying a wrapper or excluding detached checkouts. Its asynchronous list/reopen paths also need stale-response handling and create-error/retry semantics reviewed when the revised service is integrated. |
| Testing direction | User requested stopping all further test writing and execution, while preserving existing tests. Continue approved product implementation without adding or running tests. This does not waive the release's required validation or change repository test requirements: affected behavior remains unverified, and do not claim task or release completion until the required checks can run. A Workspace correction worker was already running when this direction arrived; reconcile any work it performed against this instruction. |
| Revised testing direction | User clarified: defer all test writing and execution until all product pieces are ready, then perform the required validation at the end. Preserve existing tests and continue approved implementation and code review now. No required release proof is waived; earlier test-first evidence cannot be retroactively claimed for new changes, and any work awaiting deferred checks remains unverified. |
| Replacement reset | User directed cancellation of the Workspace correction worker and restart with explicit full-replacement instructions. Interrupted session `ses_e47207e70ffexygOh4OO2T2H6x`; preserve its uncommitted work, but do not preserve old UI, old code paths, compatibility layers, wrappers, or previous architecture for their own sake. Retain only explicitly required migration, Quick Request, user-data and live-runtime safeguards. Defer all testing until the product pieces are ready, then satisfy the existing release gates. Prioritize directly connected product workflows over infrastructure and repeated review. |
| Restarted implementation | New worker reported `cargo check --lib` fails because the interrupted Workspace rewrite left `organizational_workspaces.rs` absent while its module and callers remain. This is unfinished implementation, not a product decision or reason to stop. Worker resumed to implement the replacement organizational service and connected existing/new repository workflows, without preserving the legacy home/branch model. Testing remains deferred; no release pass is claimed. |
| Organizational replacement safety correction | Worker added a fresh organizational service and connected capture UI, reporting Rust binary checks passed; frontend build and all tests remain deferred/unrun. Integration review found the new local-repository code fabricates a Git author/email and disables hooks/signing, and can adopt an existing destination based only on Git state and commit subject. The organization SQLite path opens an existing database without established ownership; operation-ID reuse also fails to check the original request fingerprint. These violate explicit user-data and bootstrap requirements. Do not use this path until corrected; the worker is fixing the actual implementation rather than adding compatibility layers. No live data, services or GUI were accessed. |
| Workspace correction and integration gap | Worker revised local repository initialization to use configured Git identity and ordinary policy, require an operation marker, and compare request fingerprints; it reports `cargo check --bins` passed. These safeguards and interrupted initialization remain unverified pending end-of-implementation testing. Integration-owner inspection found the frontend command manifest still requires the legacy Workspace DTO and rejects the new request fields, so the UI cannot use the new service. Worker is correcting the actual wire contract and building the capture frontend. Tests remain deferred; no GUI or live services ran. |
| Workspace command wiring | Worker aligned create/list/get frontend contracts with the replacement Rust request/result DTO and reports `npm run build:capture` and `cargo check --bins` passed; two existing Rust dead-code warnings remain. It also revised incomplete organization-store initialization to resume only from its identified incomplete state. This is build evidence, not behavior, migration, IPC or GUI proof. User-directed testing remains deferred until product implementation is ready. Continue with idea organization and remaining approved workflows; do not mark T04/T09 complete. |
| Inbox and organization slice | Worker reports wired Inbox/All work and Workspace collections, stable-ID moves, priority/tags/manual ordering/dependencies and filters through Rust commands and presentation. It reports Rust binary check and capture frontend build passed; no tests were written or run. Source inspection shows organization metadata uses a journaled append with revision checks, and move uses exclusive rename; competing operations, interruption/recovery and native IPC remain unverified. Pending updates are visible but cannot yet be reconciled. Human-attention filtering remains dependent on lifecycle data. Continue independent T03 shared-service product work while retaining all required validation for the end. |
| Shared session discovery | Worker connected an explicit read-only shared-service session list through Rust and the capture GUI, reporting Rust and frontend builds plus JSON/diff checks passed. It did not contact the live service or run tests. Old private-owner handoff remains blocked pending evidence and migration; that does not by itself block creation and restoration of newly bound shared-service sessions. Continue their exact service-qualified provenance and interactive terminal path without duplicate prompt sends or execution authority. T03 and Quick Request lifetime are incomplete. |
| Shared conversations and Quick Requests implementation | Worker added new Workspace session create/adopt/list/attach commands and shared Quick Request create/list/restore/prompt/delete paths, plus presentation and service bindings. Worker reports Rust release check and capture frontend build passed; no tests, GUI, provider or service requests ran. Endpoint-derived namespaces do not prove server-process identity, native PTY/session attachment and prompt-once behavior remain unverified, and legacy owner/session handoff and migration remain blocked. These are implementation-in-progress, not T03/T12 acceptance. |
| Rust authority foundation | Worker added service-qualified discussion bindings, scope revisions, operation/decision records and form registration/reply handling in `work_authority.rs`, shared by Tauri and `project-mgr-work`. UI can bind a Draft to a selected Workspace session and display authority state. Worker reports Rust release check, adapter build and frontend build passed; no tests, GUI, service/provider or migration ran. `work.begin` and canonical scope updates remain fail-closed; transition logic, trusted caller/form provenance, recovery and adapter distribution are incomplete and unverified. Continue bridge and remaining product implementation; T05 is not complete. |
| Service-side bridge foundation | Worker added a local OpenCode V2 plugin package, bounded shell-free adapter invocation, session prompt/context hooks and ticket/Workspace guidance. Unbound sessions do not initialize authority; managed child dispatch currently fails closed because explicit assignments are not implemented. Worker reports Rust, adapter, bridge and frontend builds and static checks passed; no tests, GUI, plugin installation, service or provider calls ran. Trusted caller provenance, child assignment/reuse, native effect wrappers, form observation, idle handling and relocatable distribution remain incomplete and unverified. |
| Child and native-effect wiring | Worker reports adding durable bounded assignments/dispatch claims, Rust native-effect intents, and plugin wrappers for native subagent, worktree create/remove and session move, with invocation-local IDs and exact-child admission. Native results remain uncertain pending live verification; Rust release check, adapter/bridge builds and static checks passed per worker; no tests, runtime, GUI or provider ran. Runtime interception, race/retry, reconciliation and scoped enforcement remain unverified. T05–T07 are not complete. |
| Continuous implementation direction | User directed that the implementation worker own the whole remaining approved product rather than receiving sequential narrow slices, with integration retained by the parent. The prior worker reported an inability to access the relocated checkout; resumed it with the supported session-move/absolute-path instructions. Preserve all work and defer testing until product pieces exist; no GUI E2E or live rollout is authorized. |
| Workbench partial implementation | Worker added partial ticket Overview/Conversation/Changes and Markdown Tools, and reports Rust/frontend/bridge builds passed. Existing-session binding and terminal presentation are implemented but not accepted; Changes does not yet resolve a verified execution context, Tools lacks context actions, and native IPC/terminal behavior remains unverified. Worker returned before the required whole-release mandate was complete; a new worker has the entire remaining implementation, not a single task. This is request 1 of the user's maximum five further subagent requests. |
| Existing-store admission correction | Integration review found the new organizational connection could create/open its separate SQLite store without checking for legacy management DB/sidecars first. Restored `startup::admit` before any organizational store effects and corrected the isolated UX note. This is an untested code change; testing remains deferred. Existing-store migration and verified backup remain unimplemented, and pathname/concurrent creation boundaries still require end-of-work validation. |
| Whole-release implementation continuation | Second post-limit worker request returned before the whole-release mandate was complete. Worker reports expected-revision title/lifecycle updates, read-only legacy inventory, hashed backups, gated run admission/recovery and a fail-closed runner scaffold, with Rust/frontend/bridge builds passing. These claims are not acceptance evidence: actual historical conversion/restore/cleanup, forms/reconnect and runner scenarios are incomplete. No tests, GUI, live service/provider calls or migration ran. Remaining approved implementation continues; testing stays deferred until all product pieces exist. |
| Legacy inventory review note | Current `legacy_migration::inspect` uses SQLite `READ_ONLY` against the original pathname. That alone does not establish byte-preserving behavior for WAL/SHM or prevent pathname replacement; validate the actual historical live-WAL boundary at the deferred gate and do not present this source inspection as proof. An absent main DB with sidecars also needs explicit blocked/recovery treatment. No live inventory was run. |
| Orchestration limit | The third post-limit worker returned without code changes and confirmed that historical conversion/restore/cleanup, forms/reconnect, shared-service transitions, packaging and integration remain unfinished; those are not blocked merely by deferred validation. A fourth worker is directed to implement all remaining ready product workflows, not report another inventory. At most one further subagent request remains after it. No tests, live service/provider calls, GUI E2E or live migration have run. |
| Final permitted worker request | Fourth worker returned after only limited legacy inventory edits, leaving the product substantially incomplete. The fifth and final permitted subagent request is now implementing the entire remaining release; no further subagent calls are authorized. Integration owner must complete/review remaining work directly after it returns. No tests or live operations ran. |
| Fifth worker return / backup safety | Final worker reports adding backup-bundle restore and UI, with builds passing; historical conversion, cleanup, forms/reconnect and integration remain incomplete. No tests or live operations ran. Integration-owner source review found the new backup and restore paths use `fs::rename` after a separate existence check and recursively remove their staging pathname on failure; a replaced destination or staging path can therefore affect unrelated data. Restore also compares copied bytes with a newly reread source rather than the manifest's previously verified digest, allowing source changes between verification and copy to be reported as verified. Do not run or rely on these backup/restore commands; their safety must be corrected and validated before use or migration. No subagent requests remain. |
| Inventory command integration gap | The current Rust `LegacyInventory` serializes `databaseSha256` and `sidecars`, but the checked-in frontend command contract rejects unknown result fields and does not include either. The inventory UI therefore cannot accept the current Rust result. This must be fixed and verified when deferred behavioral/contract testing is allowed. The previous inventory code also does not establish safe, byte-preserving live-WAL inspection; do not run it on user data. |
| Updated delegation direction | User lifted the five-request limit and clarified that T01–T12 are the minimum delegation granularity: do not assign narrower slices; if a worker cannot finish its task, broaden its ownership to include more task responsibilities instead. Continue one implementation worker at a time. Testing stays deferred until all product pieces are ready; no live rollout, service changes, provider calls or GUI E2E are authorized. |
| T01/T02/T11 worker return | Worker reports per-Workspace inventory and contract updates, backup/restore path hardening and managed update checks; `cargo check --lib`, capture build and diff check passed. It also reports `cargo check --all-targets` found existing test-target compile errors; no tests were run and their repair remains deferred. Its combined assignment is incomplete: durable mutation recovery, actual historical conversion, retention/cleanup journals and recovery are missing. Per user direction, broaden the next implementation assignment to include the interdependent remaining T01–T12 responsibilities rather than splitting into narrower work. These changes and safety claims remain unverified. |
| Broadened T01–T12 worker return | Worker reports durable pending title/status append records, backup/restore hardening and UI lifecycle updates with Rust/frontend builds passing; no tests, GUI E2E, live migration, service/provider calls or installation ran. It returned before completing its broadened assignment while confirming that independent approved implementation remains. T02 recovery validation, shared identity/handoff, bridge/forms/reconnect, verified workbenches, historical conversion/cleanup and executable acceptance remain incomplete. Continue full-plan implementation; the user has not waived any release requirements. |
| Release staging implementation | Worker reports shared-session process-incarnation checks, expanded legacy inventory and package staging at `/tmp/opencode/idea-first-release-stage-20261108-final`; Rust/frontend/bridge builds passed. No tests, GUI E2E, live migration, service/provider calls or installation ran. Historical conversion and cleanup, executable runner suites and acceptance remain incomplete. Package staging is not product or release completion. |
| Validation scheduling correction | User objected to repeated Cargo/npm builds and formatting after small changes. Defer routine builds, formatting and other validation along with tests until the product pieces are ready; perform an earlier build only when needed to resolve a concrete implementation blocker. No release requirements are waived. Interrupted the active worker to apply this direction, preserving its work. |
| Parallel task ownership | User clarified that the objection was to repeatedly issuing granular slices, not to parallel agents. User explicitly authorized parallel implementation, replacing the earlier one-worker-at-a-time limit. Delegate complete T01–T12 task scopes with clear integration ownership and no overlapping file edits; the parent integrates shared callers. User did not prohibit all builds or establish an exception rule: defer tests until all product pieces are ready, and do not rerun builds/formatting as routine small-change checkpoints. Existing preservation, no live migration/service/provider calls and no GUI E2E requirements remain. |
| Parallel full-task execution | Three implementation workers now own complete, combined task scopes: T01/T02/T11 storage/admission/migration; T05–T08 authority/bridge/native effects/forms; T03/T04/T09/T10 shared sessions/Workspaces/presentation/workbenches. Their production file ownership is separated, with the parent responsible for shared command composition and T12 release integration. They must continue whole-task implementation rather than hand back granular slices. No test/native/live/provider acceptance is claimed. |
| Storage/migration integration review | T01/T02/T11 worker reports production service entry points complete without tests/builds. Shared `lib.rs` already has initial command wiring. Review found `unlink_excluded_multi_repository` retains the excluded legacy Workspace row as an FK anchor and only deletes selected association tables; T11 explicitly requires a separate retention representation resolving the archive FK and unlinking the excluded owner record. This is not the approved migration result. Quick Request archive/restore behavior and remaining migration/backup safety are also not established. Per user direction, return the incomplete assignment with broader ownership including T12 implementation; no tests or live data operations run. |
| Authority/bridge integration review | T05–T08 worker returned incomplete: `work.update` remains a stub, native-effect reconciliation and protocol operations remain unfinished, and storage integration remains unfinished. Following the user's broaden-not-slice direction, combine responsibility for T01/T02/T05–T08/T11/T12 under one implementation owner so that dependency and integration cannot be passed between separate workers. T03/T04/T09/T10 app/session owner continues independently. No tests or live operations ran. |
| App/session worker return | T03/T04/T09/T10 worker returned without changes, citing old-service handoff and authority dependencies. Those block only affected legacy or execution paths, not implementation of fresh shared sessions, organizational workflows, workbench presentation, or integration tooling. Broaden its assignment to include T12 product distribution and runner responsibilities; combine storage/migration with T05–T08 under the other worker. Test/native/provider acceptance remains deferred, not a reason to stop implementation. |
| Broadened parallel ownership | Restarted two implementation workers concurrently with non-overlapping production file ownership: one owns complete T01/T02/T05–T08/T11, including the previously split storage/authority dependency; the other owns complete T03/T04/T09/T10/T12, including actual app callers and distribution/runner work. Parent owns integration and the authoritative primary handoff. Existing legacy data and runtime remain untouched; tests and native acceptance remain pending. |
| Network interruption recovery | User reported both workers stuck after a network issue. Although the service listed them as running, that was not evidence of progress. Interrupted the two exact worker sessions and resumed them with their existing full task ownership and file boundaries; preserve all uncommitted work. Testing and live-operation restrictions remain unchanged. |
| App/release worker continuation | App/release worker reported navigation, session context and some runner changes but returned with T03/T04/T09/T10/T12 incomplete. It observed Rust compile errors in parallel-owned ticket/migration files; no tests or live operations ran. Per user's direction its ownership is broadened to include T05–T08 app/bridge integration and it resumes the whole combined scope. Deferred tests and broad scenario execution remain at the end, not progress checkpoints. |
| Backend ownership continuation | Prior backend worker returned repeatedly with production increments but no completed assigned scope. Its uncommitted work is preserved; a fresh worker now owns the complete remaining backend/release outcomes while the app/integration worker continues in parallel. No tests, routine builds, native GUI, live migration/service/provider operations or release acceptance are claimed. |
| Delivery result contract | Backend worker added commit/merge readback and single-use authorization receipts and reports an additive `deliveryEffects` field in `WorkResponse::Recovery`. Parent/app integration must preserve this field in frontend and IPC validation. No tests or builds ran; push and resource-removal authorization remain separate. Full backend implementation remains in progress. |
