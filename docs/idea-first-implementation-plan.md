# Idea-first release: implementation-plan handoff

**Status:** plan pending explicit approval; implementation not started.

**Prepared:** 2026-11-07, after the parent's review of the planning concerns.

**Release:** one complete product release, including eligible existing-Workspace
migration. Tasks below are internal implementation boundaries, not partial releases.

## Approval and authority

This file plans later implementation. Product decisions have been reviewed;
production mechanisms and release acceptance have not been implemented or validated.
Writing or reviewing this plan authorizes no production edits, installation, live
database mutation, cleanup, service restart, provider request, or runtime change.

- **Plan approval:** pending. Record the approving conversation/date and any
  amendments here before starting T01. Approval must cover the complete release,
  task boundaries, acceptance gates, and stated limits, not just the next task.
- **Implementation evidence:** none for this plan. Research results and historical
  production baselines are inputs, not completed tasks or current suite passes.
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
| [Runtime/storage experiments](ticket-runtime-storage-experiments.md) | T02/T05/T11: cooperating writers, external-editor counterexample, operational authority, backups, and transport limits. |
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
| C16 | Host enforcement after deliberate plugin removal; cryptographic human identity against equivalent same-user clients; universal filesystem CAS against arbitrary editors; arbitrary in-flight seamless upgrade. Not claimed. | T02, T03, T06, T08 | Explicit limits and degraded/recovery checks, never a substituted guarantee |

## Reviewed concerns and implementation gates

The parent accepted all nine concerns as requirements, not new user-intent blockers.
This is their single register; task sections give the actual deliverables.

| Risk | Evidence / concern | Lead owner; related tasks | Pass or stop gate |
|---|---|---|---|
| R01 | Runtime experiment lost an unlocked external edit after final check/before rename; protocol logical ordering is not an algorithm. | T02; T05 | Early production mutation evaluation preserves edits/rejects conflicts under declared representative interleavings. Block with evidence if unmet; no pause ceremony or universal-CAS claim. |
| R02 | `ManagementStore::from_connection` auto-migrates/checkpoints/syncs; Tauri starts legacy recovery/cleanup immediately afterward. | T01; T02, T11 | GUI and adapter gate side-effecting store opening and workers before backup/inventory/recovery. Product/filesystem migration is not an ordinary SQL startup transaction. |
| R03 | `0019_legacy_task_archive.sql` and other owner FKs restrict Workspace removal; legacy cleanup must retain actual repositories. | T11 | Retention representation and independent cleanup manifest survive unlink and crash with FKs enforced; retained Git/files/history unchanged. |
| R04 | `Runtime::ensure_started_locked`, `shutdown`/`Drop`, tray Quit and installed contract tests own/kill a private server. | T03; T12 | Authenticated shared connection and safe old-owner handoff; quit/reopen preserves ongoing owner/subagent/plugin work, no duplicate session/prompt. Correct unsupported history limit500 with real contract proof. |
| R05 | Session owner/directory immutable; migration24 roles and restore assume managed Workspace paths. | T05; T03, T11 | Service-qualified, generation-checked bindings and reconciled mutable context work through real core; old/stale/worker writes reject; Quick Requests keep their semantics. |
| R06 | Research proves bounded native/context feasibility, not production plugin/form/idle behavior; current coordinator is local and fixed-worker. | T06; T07, T08 | Packaged service-side bridge, native foreground/background child admission, form continuation and idle/reconnect tests pass. Failed required native seam blocks release; no silent replacement by custom dispatch. |
| R07 | Creation/discovery/readers depend on wrapper homes, managed-library exclusions, mirrors and aliases. | T04; T10, T11 | Ordinary local/retained repos explicitly register; safe discovery and retained notes work without wrapper/mirror/symlink. Bootstrap collision/identity/partial-success retries preserve data. |
| R08 | Tools/Docs/Changes currently resolve Workspace homes/managed metadata, not ticket file/run context. | T10 | Rust resolves identity/action to correct file/context on every view; absent context neither hides file actions nor provisions resources. Stable terminals and stale-selection safety demonstrated. |
| R09 | Existing tests are not full-release E2E; no explicit native app-path override found; bundling disabled and historical suite failures documented. | T12; T01, T05 | Minimal isolated production seams and concrete runners exist; fresh baseline recorded, relocated package works GUI-closed, separate IPC/native proofs retained. Unrun/failed required gates remain release blockers. |

## Task status and dependencies

All tasks start **not started / awaiting plan approval**. Update this table and
the implementation record below after each completed task or blocked gate.

| Task | Outcome | Depends on | Initial status |
|---|---|---|---|
| T01 | Safe entry/configuration and acceptance foundation | Plan approval | Not started |
| T02 | Canonical Markdown store, conflict handling, backup/recovery | T01 | Not started |
| T03 | Shared OpenCode connection, restore and runtime lifetime | T01 | Not started |
| T04 | Organizational context and ordinary repository bootstrap | T02 | Not started |
| T05 | Rust work authority and packaged one-shot adapter | T02, T03, T04 | Not started |
| T06 | Service-side context bridge and instruction package | T05 | Not started |
| T07 | Native effects, attribution and reconciliation | T06 | Not started |
| T08 | Session decisions and lifecycle observation | T07 | Not started |
| T09 | Capture and organization presentation | T04, T05 | Not started |
| T10 | Ticket/Workspace workbenches and verified Tools/readers | T08, T09 | Not started |
| T11 | Historical migration and bounded legacy cleanup | T10 | Not started |
| T12 | Complete-release integration and executable E2E acceptance | T01–T11 | Not started |

T02 and T03 may progress independently after T01. T09 may progress alongside
T06–T08 once its dependencies pass. One integration owner maintains shared command
and schema contracts; this does not authorize spawning agents. A dependent task
may prepare tests earlier, but cannot claim completion against stubbed prerequisites.

### Common task completion rule

For each task: add/extend the smallest behavior-level regression; demonstrate the
missing behavior before production changes where practical; implement through
production services; run focused checks; update affected living docs and matrix
rows; record commands, exit results, evidence, and unvalidated paths here. Use real
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

## T02 — Canonical ticket storage and early conflict gate

**Boundary:** canonical file/index/recovery service and early conflict mechanism
gate; T05 adds authority semantics on top of the proven mutation boundary.

**Inputs:** R01/R02; [ticket authority](idea-first-project-mgr-proposal.md#ticket-authority-keep-one-work-record);
[mutation boundary](ticket-session-protocol-proposal.md#markdown-mutation-and-operational-commit-boundary);
runtime report sections on storage protocol, authority, and backup.

**Owned deliverables:**

- Versioned ticket encoding/scope projection, canonical read/mutation API,
  cross-process journal/recovery and rebuildable index implementing the linked
  authority/mutation contracts. Cover identity/path changes and invalid/external
  file states; expose readable canonical content during unresolved recovery.
- **Early gate:** evaluate the selected production strategy with bounded saves
  before/inside/after mutation: stale baseline, overlapping patch, unrelated edit,
  in-place/rename save, validation-to-write window and recovery-time edit. Retain
  sanitized ordering/assertions. Preserve external content and pending managed
  changes for reread/reconciliation; do not preselect an untested race-free method.
- Coherent Markdown/staging/SQLite snapshot and restore API with verified manifest;
  external-write inconsistency must retry/report, not bless an inconsistent backup.
  Audit bundled SQLite/WAL settings and state actual filesystem/durability limits.
- Update storage/workflow docs and matrix; provide T05 scope-invalidation signals.

**Exclusions:** native effects, approval/forms, GUI editor, general bidirectional
sync, transcript/prompt persistence, dedicated history UI, live data conversion.

**Validation-pass:** required edit interleavings preserve external bytes/reject
conflicts; distinguish that tested contract from universal uncooperative-editor
CAS. Failure blocks T05 with evidence, not a pause ceremony. Cooperating-process
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

These are **new proposed deliverables**, not existing commands. T01 starts the
minimal runner; feature tasks add scenarios with their production seams; T12 owns
the complete contract and execution from the repository root:

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
  event disconnect/reload, editor interleavings and native startup failure.
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
3. Edit the actual Markdown with the fixture editor; retry a managed stale update
   and overlapping patch, then reread/reconcile. Apply T02's bounded in-place and
   rename-save interleavings. Expect preserved external bytes, conflict/pending
   change visibility, correct scope invalidation and no fabricated approval.
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
2. Externally edit during recovery; test corrupt/missing stage, invalid Markdown,
   duplicated ID and unavailable ticket home. Expect retained readable content,
   blocked unsafe writes, actionable reconciliation and no fabricated authority.
3. Take coherent backup while cooperating writes and bounded external saves run;
   verify hashes or reject/retry the inconsistent generation. Restore into a fresh
   isolated destination. Expect matching canonical Markdown, operational links,
   pending operations and valid receipts. DB-only, mismatched, corrupt and missing-
   authority restores cannot resume managed work or guess rights.
4. Retain backup manifests, sanitized recovery assertions and file hashes. A
   process-crash pass is not labeled power-loss or arbitrary-editor-CAS proof.

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
E01–E12 complete in their applicable layers; early conflict mechanism gate passed;
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
2. Verify recorded plan approval covers the next action. Before approval, only
   plan review is ready. After approval, choose the first uncompleted task whose
   dependencies passed; continue ready work without per-task approval prompts.
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
| Approval reference/date | Pending |
| Completed tasks / evidence | None |
| In-progress task | None |
| Implementation blockers | None discovered beyond the explicit unproven mechanism/acceptance gates above |
| Known unvalidated paths | Production mutation/authority/adapter/plugin/forms/idle; shared-service transition/quit; packaging; new migration/cleanup/restore; IPC/GUI/native/Wayland/provider acceptance |
| Planning validation | Revised plan passed documentation-only checks on 2026-11-07: 47 local links/anchors; 12 task fields/status/dependencies; C01–C16 coverage, R01–R09 ownership/gates, E01–E12 definitions; preserved runner/config/package deliverables and synthetic/real-model proof boundary; whitespace/fences. Diff whitespace check emitted no warnings. No production build/test, process/config/data operation or provider call ran. |
| Parent review/validation | Read the full draft, reviewed all nine concerns against the source/specifications, corrected three stale protocol statements, and resumed the same subagent for completion and a tighter revision. Independent documentation checks passed across 10 documents and 133 local links/anchors, whitespace/fences, 12 task/dependency rows, 16 coverage items, 9 concern gates, 12 E2E scenarios and task-boundary fields. No production build/test or live operation ran. |
| Next safe action | Parent/user review and explicit complete-plan approval; no production work yet |
