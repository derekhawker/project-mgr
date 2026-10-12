# Implementation Handoff

This document is the runbook for an agent that coordinates implementation of
the application. The reader is primarily an orchestrator: it dispatches small
implementation tasks to subagents, dispatches a fresh validation subagent after
each task, records the evidence, and advances only when the task's completion
criterion is met.

Product behavior belongs in the application workflow specification. This file
defines execution order and subagent protocol; it does not restate the product
model.

## 1. Orchestrator Operating Rules

1. Read the reference map before dispatching work. Reach the detailed
   reference when a task's scope requires it; do not recreate requirements from
   memory.
2. Preserve `prototype/quick-request/` as the working integration reference.
   Production code is created outside that directory.
3. Work on one implementation task at a time. A task is not complete when the
   implementer reports success; it is complete only after a fresh validator
   reports pass and the orchestrator confirms the evidence.
4. Use one implementation subagent for each task. Use a separate fresh-context
   validator subagent for that same task. The validator must not be the
   implementation subagent resumed in the same context.
5. Give each subagent the task ID, exact scope, reference paths, constraints,
   and completion criterion. Do not send a vague request to "continue the
   implementation."
6. Keep the implementation slice small enough that its changed files and test
   evidence can be reviewed as one unit.
7. If validation fails, keep the task in progress. Dispatch a repair subagent
   with the validator's findings, then run a fresh validation pass. Do not mark
   the task complete because a later task might compensate for a failure.
8. The orchestrator may inspect files, run commands, resolve cross-task
   conflicts, and update this execution record. Production code changes should
   be made by implementation subagents.
9. Do not commit, amend, or push unless the user separately requests it.
10. Replace every placeholder command in a dispatched prompt with the actual
      command from the current package manifest, Cargo manifest, or task setup.
      A validator must never receive an unresolved `<command>` placeholder.
11. Follow [`gui-testing.md`](gui-testing.md) for GUI evidence. Keep visual,
    terminal, window, tray, and lifecycle acceptance manual in the target
    Wayland session. Do not add Xvfb or private-Weston automation or claim GUI
    acceptance from a display-isolation attempt. Bring the app to the foreground
    before judging visibility; an occluded shared-desktop view is inconclusive.

I-01 and I-02 have passed fresh independent validation. The user reports
completing the updated SQLite-enabled shell's manual Wayland verification; this
is user-reported acceptance, not independent evidence. The next gate to resolve
before I-03 is P-00's remaining OpenCode integration/registration acceptance;
P-00 did not gate I-02. For every implementation task, dispatch exactly one
implementation subagent and then a fresh, independent validator subagent as
specified above. This workspace has no `.git` metadata, so no formal diff was
available during I-02 validation; see its completion record for that residual.

## 2. Reference Map

| Reference | Use it for |
|---|---|
| [`../.requirements.md`](../.requirements.md) | Product model, hierarchy, lifecycle rules, repository/worktree behavior, persistence requirements, and remaining integration constraints. |
| [`mockups/project-manager-low-fi.svg`](mockups/project-manager-low-fi.svg) | Exploratory reference for persistent workspace/task navigation, secondary recent Quick Requests, selected-workspace focus, and terminal-dominant layout; not a final visual specification. |
| [`../.opencode-handoff.md`](../.opencode-handoff.md) | Approved technical direction, Tauri/Rust/raw HTML architecture, SQLite boundary, OpenCode ownership, process lifecycle, and prototype status. |
| [`application-workflows.md`](application-workflows.md) | Normative actors, storage layout, invariants, all user/application sequence flows, failure behavior, registration-tool contract, and lifecycle policies. This is the primary behavior reference. |
| [`opencode-terminal-e2e.md`](opencode-terminal-e2e.md) | Session-neutral terminal runtime, startup order, PTY/xterm event flow, restore behavior, status recovery, and terminal acceptance conditions. |
| [`opencode-v2-contract.md`](opencode-v2-contract.md) | Verified installed OpenCode v2.0.27 server/API/TUI contract, migration differences from v1, and unresolved v2 acceptance blockers. |
| [`../prototype/decisions/opencode-terminal.md`](../prototype/decisions/opencode-terminal.md) | OpenCode v1/v2 compatibility facts, the app-owned server choice, TUI/PTY rationale, event semantics, and integration risks. |
| [`../prototype/decisions/quick-request-manual-verification.md`](../prototype/decisions/quick-request-manual-verification.md) | Manual Quick Request acceptance flow for visible streaming and same-session follow-up. |
| [`../prototype/quick-request/README.md`](../prototype/quick-request/README.md) | Prototype run requirements, installed OpenCode contract, server/TUI arrangement, and process behavior. |
| [`../prototype/quick-request/src-tauri/src/lib.rs`](../prototype/quick-request/src-tauri/src/lib.rs) | Working Rust implementation of server startup, session creation, PTY attachment, event forwarding, terminal input, resize, tray, and window hiding. |
| [`../prototype/quick-request/src/main.js`](../prototype/quick-request/src/main.js) | Working raw JavaScript terminal/session handling, output buffering, tab selection, restore, and Quick Request controls. |
| [`../prototype/quick-request/src/terminal-protocol.js`](../prototype/quick-request/src/terminal-protocol.js) | Tested xterm.js XTGETTCAP handler. |
| [`../prototype/quick-request/test/terminal-protocol.test.js`](../prototype/quick-request/test/terminal-protocol.test.js) | Real xterm.js parser regression test. |
| [`../prototype/quick-request/test/tauri-capabilities.test.js`](../prototype/quick-request/test/tauri-capabilities.test.js) | Tauri event-listening capability regression test. |

When a task conflicts with a lower-level implementation note, the workflow
specification and approved technical direction win. Preserve the prototype's
working integration behavior unless the task explicitly changes that boundary.

## 3. Subagent Dispatch Protocol

### 3.1 Implementation subagent

Dispatch a `build-subagent` with a prompt containing:

```text
You are implementing task <TASK-ID>: <TASK-NAME>.

Read these references before changing code:
- <reference 1>
- <reference 2>

Scope:
- <specific behavior to implement>
- <specific behavior to test>

Constraints:
- Preserve the approved architecture and existing prototype boundary.
- Do not change files outside the task scope unless required and reported.
- Do not redesign behavior defined by the workflow specification.

Completion criterion:
- <observable criterion>

Before returning:
- Run the task's targeted tests and checks.
- Report changed paths, commands run, results, known limitations, and any
  follow-up needed by the validator.
```

The implementer owns the code and test changes for the task. It must leave the
workspace in a runnable state even when a later task is still needed.

### 3.2 Validation subagent

After the implementation subagent returns, dispatch a fresh `general` or
`build-subagent` context with a prompt containing:

```text
You are the independent validator for task <TASK-ID>: <TASK-NAME>.

Read these references:
- <same task references>
- <workflow section defining the behavior>

Inspect the implementation and tests currently in the workspace. Do not edit
files. Verify the completion criterion and look for regressions at the task's
boundaries.

Run:
- <targeted test commands>
- <build/typecheck commands>
- <manual or GUI check, if required>

Return exactly:
- PASS or FAIL
- evidence with command output summaries and relevant paths
- failures or missing coverage
- residual risk that later tasks must address
```

For application behavior, test locally on both sides of each Tauri command:
Rust tests cover behavior, validation, and serialized results; frontend tests
cover command names, payloads, and result/error handling. Keep layout, rendering,
terminal, window, tray, and visual lifecycle acceptance manual on the target
Wayland session until the user explicitly reopens GUI automation. Bring the app
to the foreground before judging visibility; an occluded shared-desktop
screenshot is inconclusive. For Rust/data tasks, use isolated temporary fixtures
and check persisted state, not only return values.

See [`gui-testing.md`](gui-testing.md) for the manual GUI boundary and unit-test
guidance.

### 3.3 Repair loop

When a validator returns `FAIL`:

1. Preserve the validator report as the task's failure evidence.
2. Dispatch a repair subagent with only the failed criterion and relevant
   evidence in scope.
3. Run the targeted checks again.
4. Dispatch a fresh validator, not the previous validator context.
5. Repeat until the validator returns `PASS` or the orchestrator reports a
   concrete blocker to the user.

### 3.4 Task completion record

For every completed task, the orchestrator records:

| Field | Value |
|---|---|
| Task ID | Implementation task identifier below. |
| Implementer | Subagent task ID. |
| Validator | Fresh subagent task ID. |
| Changed paths | Production and test paths touched. |
| Evidence | Commands, GUI checks, fixtures, and result summaries. |
| Residual risk | Only risks not covered by this task's criterion. |
| Status | `pass`, `blocked`, or `needs-repair`. |

## 4. Ordered Implementation Tasks

The order is dependency order. Do not start a task until every task listed in
its `Depends on` field has passed validation.

### P-00: Confirm the integration baseline and registration boundary

**Depends on:** none.

**Read:**

- [`../.opencode-handoff.md`](../.opencode-handoff.md), prototype status and
  required pre-production prototype outcomes.
- [`../prototype/decisions/quick-request-manual-verification.md`](../prototype/decisions/quick-request-manual-verification.md).
- [`opencode-terminal-e2e.md`](opencode-terminal-e2e.md), acceptance checks.
- [`application-workflows.md#9-task-workflows`](application-workflows.md#9-task-workflows).
- [`application-workflows.md#131-registration-tool-contract`](application-workflows.md#131-registration-tool-contract).

**Implement:**

- Treat the existing Quick Request prototype as the disposable integration
  harness. Run its automated checks and built GUI path before creating
  production replacements.
- Complete the model-backed Quick Request checks for visible fresh-response
  streaming and same-session follow-up, including hide/reopen behavior.
- Complete the prototype checks for two sessions sharing one directory, saved
  history restore without generation, approval/user-input handling, running/
  waiting/ready-for-review status classification, and event-loss recovery.
- Exercise workspace, task, and Quick Request sessions through the same terminal
  runtime and verify each resolves its own directory and exact session ID.
- Verify hiding/showing the app preserves sessions and full quit leaves no TUI
  or server child behind.
- Defer dismissed Quick Request and completed-task history acceptance until the
  durable production records and corresponding workflows exist (I-05, I-09,
  and I-10); do not report those prototype-inapplicable checks as passes.
- Build the disposable registration/worktree experiment at
  `prototype/registration-worktree/`, with a README containing one reproducible
  run command. It must exercise structured reports from OpenCode, Rust
  validation, multiple repositories, partial setup failure, clean/dirty/in-use
  cleanup classification, and branch retention.
- Record the concrete CLI/API, tool payload, validation, and cleanup behavior
  that production tasks must preserve in that experiment's README and tests.

**Validate:**

- A fresh validator subagent runs the prototype tests/build and observes the
  model-backed GUI flow rather than accepting API-only evidence.
- The validator observes two sessions in one directory, restores saved history
  without sending a prompt, answers an approval/user-input flow, verifies
  running/waiting/ready-for-review states, and forces an event
  reconnect/reconcile.
- The validator exercises workspace, task, and Quick Request contexts through
  the same terminal runtime and confirms context isolation by directory and
  exact session ID.
- The validator hides/shows the app during active work and verifies full quit
  leaves no TUI or server child behind.
- A fresh validator exercises the registration/worktree experiment with Git
  fixtures using its documented command and checks persisted/returned results
  for every resource item.
- The validator confirms that the experiment does not add a second service,
  duplicate OpenCode history, or change the approved terminal boundary.

**Completion criterion:** the integration and structured registration/worktree
boundary have executable evidence before OpenCode-dependent production
implementation begins. This broad task remains blocked until its prototype-
evaluable acceptance is resolved; user-reported completion of the Quick Request
manual scenarios is recorded separately below and is not a substitute for the
other criteria. Durable dismissed-request/completed-task history checks are
explicitly deferred to the production workflows that create those records.

**Acceptance update:** the user reports that the Quick Request v2 manual Wayland
check is done, covering explicit model selection and use, TUI streaming and
follow-up, and the requested restore, multiple-session, and lifecycle checks.
The conversation provides no scenario-by-scenario observations. Record this as
user-reported acceptance, not as a fresh validator's observed pass. P-00 remains
blocked on:

- The fresh independent validator observation required by the runbook.
- Approval/user-input and status/event-loss recovery evidence.
- Workspace/task context isolation through the shared runtime; those workflows
  are not implemented in the current prototype or production shell.
- The OpenCode tool invocation and full structured registration/worktree
  acceptance; the current experiment is in-memory and does not start OpenCode.

Durable dismissed-Quick-Request/completed-task history checks are deferred (not
considered passed) until the corresponding production records/workflows exist in
I-05, I-09, and I-10; they are not a prerequisite for closing the prototype-only
P-00 gate.

### I-00: Establish the production application shell

**Depends on:** none. P-00 is not a prerequisite for validating the OpenCode-free
shell.

**Read:**

- [`../.opencode-handoff.md`](../.opencode-handoff.md), approved technical direction.
- [`application-workflows.md#2-actors`](application-workflows.md#2-actors).
- [`application-workflows.md#3-canonical-storage-layout`](application-workflows.md#3-canonical-storage-layout).
- [`application-workflows.md#6-application-startup-and-recovery`](application-workflows.md#6-application-startup-and-recovery).

**Implement:**

- Create the production Tauri application outside the prototype directory.
- Use Rust for the Tauri core and raw HTML/CSS/JavaScript for the frontend.
- Add a minimal app window, Rust command boundary, frontend build, Rust test
  target, and deterministic development/build commands.
- Keep the prototype's dependency versions and terminal architecture available
  as the compatibility baseline; do not copy temporary prototype state into
  production persistence.
- Add the initial app-owned state container and a single-instance/tray shape
  that later tasks can extend.

**Validate:**

- The production frontend builds without a framework.
- Rust tests and the production build run from a clean checkout/state.
- Unit tests cover the Rust command result and the frontend's handling of that
  contract.
- Manual Wayland acceptance confirms the app launches, displays known shell
  content, and renders the harmless Rust command response. Window/tray/lifecycle
  checks are manual until the user reopens GUI automation.
- For the remaining shell acceptance, run `cd app && npm run tauri:dev` in the
  target Wayland session. Bring the window to the foreground and verify visible
  shell content, `Connected to the Rust core`, and the serialized
  `app_shell_info` response. Record what was observed; do not infer success from
  an occluded or empty screenshot.
- The prototype directory and its tests remain unchanged.

**Completion criterion:** a buildable production Tauri shell exists outside the
prototype, its Rust/frontend command boundary is tested, and manual Wayland
acceptance confirms visible shell content plus the serialized Rust command
response.

### I-01: Add management persistence and domain records

**Depends on:** I-00.

**Read:**

- [`application-workflows.md#31-management-state`](application-workflows.md#31-management-state).
- [`application-workflows.md#4-core-invariants`](application-workflows.md#4-core-invariants).
- [`../.requirements.md`](../.requirements.md), persistence and product-model sections.

**Implement:**

- Add SQLite connection, migrations, foreign keys, and transaction helpers.
- Model workspaces, tasks, repository catalog entries, repository bindings,
  sessions, Quick Request fields, cleanup jobs, and settings required by the
  workflow specification.
- Persist the project-home root setting, defaulting to
  `~/OpenCode Projects/`, and make the setting available to path resolution.
- Enforce `Workspace -> Task`, task ownership, immutable IDs, and exact session
  associations in the data layer.
- Store lifecycle state and timestamps without storing duplicate conversation
  messages.
- Make writes idempotent where startup recovery, registration, or cleanup can
  retry an operation.

**Validate:**

- Fresh database migration and reopen migration both pass.
- Foreign-key and uniqueness violations fail atomically.
- Session associations preserve owner, directory, and exact session ID.
- The project-home root setting survives restart and is used consistently by
  new workspace/task path resolution, including a non-default root fixture.
- A failed transaction leaves no partial management record.
- Tests prove completed tasks cannot be reopened through the repository API.
- A fresh validator runs the management harness through one create/restart/read
  cycle and records the persisted workspace, task, setting, and session values.

**Completion criterion:** SQLite can persist and retrieve every management
record required by the workflow specification with lifecycle invariants enforced.

### I-02: Implement path, repository, branch, and worktree safety

**Depends on:** I-01.

**Read:**

- [`application-workflows.md#32-user-project-home`](application-workflows.md#32-user-project-home).
- [`application-workflows.md#7-repository-catalog-and-discovery`](application-workflows.md#7-repository-catalog-and-discovery).
- [`application-workflows.md#144-repository-checkout-placement`](application-workflows.md#144-repository-checkout-placement).
- [`application-workflows.md#145-branch-and-worktree-authority`](application-workflows.md#145-branch-and-worktree-authority).
- [`application-workflows.md#96-cleanup-a-completed-tasks-worktrees`](application-workflows.md#96-cleanup-a-completed-tasks-worktrees).

**Implement:**

- Resolve the stored project-home root, defaulting to `~/OpenCode Projects/`,
  and create its workspace/task directory helpers.
- Canonicalize paths, reject traversal and invalid ownership, generate stable
  filesystem slugs, and handle name collisions deterministically.
- Inspect repository identity, branch existence, worktree ownership, dirty
  state, and new files through Git.
- Support existing repositories outside the project home only when explicitly
  cataloged by the user.
- Build a cleanup planner that distinguishes clean/unused, dirty, and in-use
  worktrees without deleting anything yet.

**Validate:**

- Temporary Git fixtures cover one repository, multiple repositories, an
  existing external repository, branch collisions, and multiple worktrees.
- A non-default project-home root is used in a fixture and all generated
  workspace/task paths remain under that configured root.
- A configured root outside the user's home is rejected before any directory or
  database record is created.
- Path tests reject traversal, mismatched repository identity, and worktrees
  outside the owning task's allowed location.
- Cleanup tests preserve dirty worktrees, defer in-use worktrees, and identify
  clean unused worktrees as removable while retaining branches.
- Repeated inspection produces the same result without mutating the fixture.
- A fresh validator runs the filesystem/Git fixture command manually and
  inspects the resulting paths, ownership checks, and cleanup classification.

**Completion criterion:** all filesystem and Git facts needed by later flows
are available through tested Rust primitives with safe path boundaries.

### I-03: Extract the app-owned OpenCode server and API runtime

**Depends on:** I-00, I-01, P-00. P-00 is the integration/registration gate for
this OpenCode-dependent production runtime; it does not block I-00 or I-01.

**Read:**

- [`application-workflows.md#5-common-session-flow`](application-workflows.md#5-common-session-flow).
- [`application-workflows.md#6-application-startup-and-recovery`](application-workflows.md#6-application-startup-and-recovery).
- [`opencode-terminal-e2e.md`](opencode-terminal-e2e.md), startup gates and API/session flow.
- [`../prototype/quick-request/src-tauri/src/lib.rs`](../prototype/quick-request/src-tauri/src/lib.rs).
- [`../prototype/decisions/opencode-terminal.md`](../prototype/decisions/opencode-terminal.md), compatibility and server ownership sections.

**Implement:**

- Move the working server-process ownership pattern into production Rust.
- Check the installed OpenCode version and its matching CLI/API contract at
  startup (currently v2.0.27). Use authenticated `/api/info` and `/api/session`
  routes and the root TUI `--server`/`--session` invocation. Do not assume the
  v1 `attach` command or API routes; preserve the app-owned/private server
  boundary.
- Start and reuse app-owned server processes, apply configured authentication,
  wait for health, and stop children deliberately on quit.
- Implement session create, exact session association, history lookup, status,
  event subscription/reconnection, and asynchronous prompt operations behind a
  Rust service boundary.
- Keep OpenCode conversation content out of SQLite and out of an app-generated
  transcript.

**Validate:**

- Unit tests cover CLI help/version parsing, health timeout, authentication
  headers, non-success API responses, and child-process exit.
- API contract tests use a fake server to verify exact URL, directory, session,
  and prompt parameters.
- A process lifecycle test proves the app owns and waits for its server child.
- An installed-CLI smoke check confirms the exact installed release contract,
  including app-owned server mode, API routes, and TUI session selection,
  without changing the prototype.
- A fresh validator launches the production shell against the installed CLI,
  observes server health and one exact session association, then confirms the
  app-owned child can be stopped without an orphan.

**Completion criterion:** production Rust can own an OpenCode server, create and
associate exact sessions, send prompts, read history/status/events, and cleanly
stop its child process.

### I-04: Productionize the shared terminal runtime

**Depends on:** I-00, I-03.

**Read:**

- [`opencode-terminal-e2e.md`](opencode-terminal-e2e.md), all terminal flow,
  handshake, restore, lifecycle, and failure sections.
- [`../prototype/quick-request/src/main.js`](../prototype/quick-request/src/main.js).
- [`../prototype/quick-request/src/terminal-protocol.js`](../prototype/quick-request/src/terminal-protocol.js).
- [`../prototype/quick-request/src-tauri/src/lib.rs`](../prototype/quick-request/src-tauri/src/lib.rs), PTY and event code.
- [`../prototype/quick-request/test/terminal-protocol.test.js`](../prototype/quick-request/test/terminal-protocol.test.js).
- [`../prototype/quick-request/test/tauri-capabilities.test.js`](../prototype/quick-request/test/tauri-capabilities.test.js).

**Implement:**

- Create one session-neutral PTY/runtime service for workspace, task, and Quick
  Request sessions.
- Forward ordered PTY output and exit events with exact session IDs.
- Implement per-session terminal instances, output buffering before DOM mount,
  xterm.js input, resize, focus, tab switching, and hide/reopen behavior.
- Register the XTGETTCAP handler before replaying buffered output.
- Carry the Tauri event-listening capability and error behavior into production.
- Make terminal restoration attach by stored session ID and working directory
  without sending an initial prompt.

**Validate:**

- Port the real xterm.js parser regression and Tauri capability regression.
- Test output arriving before terminal creation and output for two sessions
  sharing a directory.
- Test input and resize routing cannot cross session IDs.
- Test hiding a view preserves the PTY and reopening replays buffered output.
- Run a built GUI smoke check with a known saved session and verify visible
  history rather than only a session tab or API result.

**Completion criterion:** all session types can use one tested PTY/xterm runtime
with exact-session routing, visible restore, input, resize, and failure handling.

### I-05: Deliver the Quick Request vertical slice

**Depends on:** I-01, I-03, I-04.

**Read:**

- [`application-workflows.md#10-quick-request-workflows`](application-workflows.md#10-quick-request-workflows).
- [`application-workflows.md#101-create-a-quick-request`](application-workflows.md#101-create-a-quick-request).
- [`application-workflows.md#103-dismiss-and-restore-a-quick-request`](application-workflows.md#103-dismiss-and-restore-a-quick-request).
- [`application-workflows.md#104-quick-request-expiry`](application-workflows.md#104-quick-request-expiry).
- [`../prototype/decisions/quick-request-manual-verification.md`](../prototype/decisions/quick-request-manual-verification.md).
- [`../prototype/quick-request/README.md`](../prototype/quick-request/README.md).

**Implement:**

- Add the Quick Requests special workspace and task records.
- Create each request in the shared temporary directory and persist its exact
  session association before sending the prompt.
- Open the interactive terminal before the initial prompt, stream the response,
  support same-session follow-up, and preserve OpenCode-owned history.
- Implement dismissal, history restore, creation-time expiry, and visibility
  rules for active and input-waiting requests.
- Keep the request controls outside the terminal while keeping the terminal the
  visible source of conversation output.

**Validate:**

- Rust and SQLite tests cover creation, duplicate submission prevention,
  dismissal, exact restore, 24-hour expiry, and follow-up clock behavior.
- A model-backed GUI run proves the first terminal is visible before generation,
  output streams while the response is in progress, and a follow-up stays in
  the same session.
- A second request in the shared directory displays its own session and history.
- Closing the view and hiding/showing the window leaves the request usable.

**Completion criterion:** the Quick Request flow passes the manual acceptance
scenario with durable exact-session associations and no duplicate transcript.

### I-06: Implement workspaces and the repository catalog

**Depends on:** I-01, I-02, I-03, I-04.

**Read:**

- [`application-workflows.md#8-workspace-workflows`](application-workflows.md#8-workspace-workflows).
- [`application-workflows.md#7-repository-catalog-and-discovery`](application-workflows.md#7-repository-catalog-and-discovery).
- [`application-workflows.md#81-create-an-empty-workspace`](application-workflows.md#81-create-an-empty-workspace).
- [`application-workflows.md#71-scan-user-selected-folders`](application-workflows.md#71-scan-user-selected-folders).
- [`application-workflows.md#72-attach-a-repository-to-a-workspace`](application-workflows.md#72-attach-a-repository-to-a-workspace).

**Implement:**

- Create empty regular workspaces under the persisted project-home root, whose
  default is `~/OpenCode Projects/`, with notes, repos, and tasks directories.
- Add workspace navigation and workspace-level session creation in main-branch
  inspection context.
- Scan user-selected folders, identify Git repositories, de-duplicate catalog
  entries, and persist verified identity and paths.
- Use an OpenCode discovery session to generate concise repository purposes and
  keep identity/location independent from generated text.
- Attach existing or managed main-branch contexts to a workspace.

**Validate:**

- Workspace creation is transactional across SQLite and filesystem setup.
- Empty workspace, external repository, duplicate catalog, invalid path, and
  partial attach cases are covered by tests.
- A workspace session resolves only workspace/main context and never a task
  worktree.
- Repository descriptions can fail without losing verified catalog facts.
- The GUI can create an empty workspace, launch a workspace session, scan a
  selected folder, display catalog results, and attach a repository while
  showing partial-attach failure.

**Completion criterion:** users can create a persistent workspace, discover and
attach repositories, and open an exact workspace planning session.

### I-07: Implement task setup and the registration tool

**Depends on:** I-01, I-02, I-03, I-04, I-06.

**Read:**

- [`application-workflows.md#9-task-workflows`](application-workflows.md#9-task-workflows).
- [`application-workflows.md#91-create-a-task-from-a-workspace`](application-workflows.md#91-create-a-task-from-a-workspace).
- [`application-workflows.md#92-task-setup-with-multiple-repositories`](application-workflows.md#92-task-setup-with-multiple-repositories).
- [`application-workflows.md#93-partial-task-setup-failure`](application-workflows.md#93-partial-task-setup-failure).
- [`application-workflows.md#146-incomplete-setup`](application-workflows.md#146-incomplete-setup).
- [`application-workflows.md#131-registration-tool-contract`](application-workflows.md#131-registration-tool-contract).
- [`application-workflows.md#132-operation-boundary-rules`](application-workflows.md#132-operation-boundary-rules).
- [`../.requirements.md`](../.requirements.md), regular workspace/task setup sequence.

**Implement:**

- Create task records and task home, notes, and worktrees directories.
- Start the task setup session with repository catalog context, preferences, and
  the exact task home.
- Expose the structured registration tool to OpenCode with the specified
  operation ID, owner, session, resource, result, and error fields.
- Validate caller ownership, repository identity, branch/worktree state, path
  boundaries, task ownership, idempotency, and per-item results in Rust.
- Persist successful associations and partial failures independently.
- Support multiple repositories and safe retries without creating duplicate
  tasks or associations.
- Allow the user to cancel an in-progress setup operation without deleting the
  task or Git artifacts. The task remains setup-incomplete, records the
  cancellation, and can be resumed explicitly.

**Validate:**

- Tool contract tests cover ready, failed, not-attempted, duplicate, replayed,
  mismatched-operation, wrong-session, wrong-task, wrong-repository, and unsafe
  path reports.
- Git fixtures cover successful single- and multi-repository setup, branch
  collisions, pre-existing worktrees, and partial failure.
- A model-backed task setup run proves OpenCode can report several operations
  and Rust rejects an invalid item without losing valid items.
- SQLite state after every result matches the registration contract exactly.
- The GUI shows per-repository ready, failed, not-attempted, and canceled
  states, and resuming a canceled setup does not create a second task.
- A fixture cancels setup after Git artifacts exist and verifies persisted
  cancellation, setup-incomplete state, retained task/Git artifacts, no
  implicit cleanup, and explicit resume of the same task.

**Completion criterion:** a task can be created and receive validated,
itemized repository/branch/worktree associations through the structured
registration boundary.

### I-08: Add task sessions, input handling, and status recovery

**Depends on:** I-04, I-07.

**Read:**

- [`application-workflows.md#5-common-session-flow`](application-workflows.md#5-common-session-flow).
- [`application-workflows.md#94-start-another-task-session`](application-workflows.md#94-start-another-task-session).
- [`application-workflows.md#54-session-status-and-event-recovery`](application-workflows.md#54-session-status-and-event-recovery).
- [`application-workflows.md#125-user-input-required-while-the-view-is-hidden`](application-workflows.md#125-user-input-required-while-the-view-is-hidden).
- [`opencode-terminal-e2e.md`](opencode-terminal-e2e.md), follow-up, restore,
  status, recovery, and acceptance sections.
- [`../prototype/decisions/opencode-terminal.md`](../prototype/decisions/opencode-terminal.md), event and pending-input semantics.

**Implement:**

- Start additional conversations under an active task without creating a
  child task or mixing histories.
- Resolve task home and all task worktrees from SQLite associations.
- Classify running, waiting for input, ready for review, reconnecting, unknown,
  and failed states from events plus API reconciliation.
- Add event cursor/reconnect handling and pending-input notification/listing.
- Route approvals, forms, and follow-ups through the exact TUI/session.
- Ensure two sessions in one task or shared directory cannot receive each
  other's output, input, or status.

**Validate:**

- Two explicitly identified sessions run concurrently and keep separate output
  and history.
- A follow-up, approval, and user-input request resume the correct session.
- A dropped event connection produces reconnecting/unknown, then reconciles to
  the correct final state without treating inactivity as completion.
- A hidden terminal with pending input remains visible in the pending-input
  list and can be focused directly.
- The GUI shows separate task sessions, status transitions, pending-input
  notifications, and session-specific terminal history during these checks.

**Completion criterion:** workspace/task sessions use exact context and recover
status/input behavior without cross-session routing or false completion.

### I-09: Implement task completion and background cleanup

**Depends on:** I-02, I-07, I-08.

**Read:**

- [`application-workflows.md#95-complete-a-task`](application-workflows.md#95-complete-a-task).
- [`application-workflows.md#96-cleanup-a-completed-tasks-worktrees`](application-workflows.md#96-cleanup-a-completed-tasks-worktrees).
- [`application-workflows.md#149-sessions-after-task-completion`](application-workflows.md#149-sessions-after-task-completion).
- [`../.requirements.md`](../.requirements.md), completion and cleanup rules.

**Implement:**

- Mark tasks completed without committing, merging, discarding, or reopening
  code.
- Preserve completed task/session history while removing the task from active
  navigation.
- Queue cleanup jobs for every task worktree.
- Remove only clean, unused worktrees; retain branches.
- Defer in-use worktrees and retain dirty/new-file worktrees with a recorded
  reason and retry state.
- Keep active OpenCode sessions running after task completion and make cleanup
  observe their usage.

**Validate:**

- Clean unused, dirty, new-file, in-use, missing, and repeated-cleanup cases
  are covered with Git fixtures.
- Completing a task never invokes commit, merge, or discard behavior.
- A completed task cannot be reopened; a new task can be created later in the
  same workspace.
- Cleanup retries are idempotent and survive application restart.
- The GUI shows cleanup state in task history, including retained dirty or
  in-use worktrees and the reason cleanup was deferred.

**Completion criterion:** task completion and cleanup preserve user work,
retain branches, and safely reclaim only eligible worktrees.

### I-10: Implement workspace completion, Quick Request promotion, and history

**Depends on:** I-05, I-06, I-09.

**Read:**

- [`application-workflows.md#83-complete-a-workspace`](application-workflows.md#83-complete-a-workspace).
- [`application-workflows.md#105-promote-a-quick-request-to-regular-tracked-work`](application-workflows.md#105-promote-a-quick-request-to-regular-tracked-work).
- [`application-workflows.md#141-workspace-completion`](application-workflows.md#141-workspace-completion).
- [`application-workflows.md#142-quick-request-promotion`](application-workflows.md#142-quick-request-promotion).

**Implement:**

- Block workspace completion when active tasks exist.
- Hide completed workspaces from active navigation while preserving files,
  branches, sessions, and history.
- Reactivate a completed workspace before creating new work; never reopen a
  completed task.
- Promote a Quick Request into an existing or newly created regular workspace
  as a task, preserving identity/history and retaining old session directories.
- Give future promoted-task sessions a dedicated regular home context.

**Validate:**

- Active-task completion is rejected with the blocking tasks identified.
- Workspace completion with no active tasks preserves all history and leaves
  workspace sessions running.
- Reactivation permits a new task but cannot reopen a completed task.
- Promotion preserves prior session IDs/directories, removes Quick Request
  expiry, and routes future sessions to the dedicated task home.
- The GUI can navigate completed workspace/task history, reactivate a workspace,
  and show promoted work in its new regular location.

**Completion criterion:** regular and Quick Request history transitions follow
the specified ownership and no-reopen rules.

### I-11: Complete application lifecycle and startup recovery

**Depends on:** I-03, I-04, I-05, I-08, I-09, I-10.

**Read:**

- [`application-workflows.md#11-view-window-and-application-lifecycle`](application-workflows.md#11-view-window-and-application-lifecycle).
- [`application-workflows.md#6-application-startup-and-recovery`](application-workflows.md#6-application-startup-and-recovery).
- [`application-workflows.md#12-failure-and-recovery-flows`](application-workflows.md#12-failure-and-recovery-flows).
- [`opencode-terminal-e2e.md`](opencode-terminal-e2e.md), lifecycle and failure sections.
- [`../prototype/quick-request/src-tauri/src/lib.rs`](../prototype/quick-request/src-tauri/src/lib.rs), tray and window event handling.

**Implement:**

- Keep one Tauri process alive when the window closes and provide tray show and
  quit actions.
- Reconcile SQLite records, active children, session status, event cursors, and
  cleanup jobs at startup.
- Prevent duplicate app ownership of a running server/session.
- Hide and reopen terminal views without stopping PTYs or TUI processes.
- On full quit, stop and wait for every TUI/PTY and app-owned OpenCode server
  child before exiting.
- Surface listener, server, PTY, event, and recovery failures visibly.

**Validate:**

- Close/show the window during active model work and continue in the same
  session.
- Hide/reopen multiple terminal views without creating duplicate sessions.
- Quit and verify no app-owned TUI or server child remains.
- Restart after an interrupted run and reconcile active sessions and cleanup
  jobs without duplicate ownership.
- Verify only one tray/app instance exists.

**Completion criterion:** window hiding, tray recovery, startup reconciliation,
and full quit obey the process ownership rules without orphaned children.

### I-12: Run cross-feature acceptance and hardening

**Depends on:** I-05, I-08, I-09, I-10, I-11.

**Read:**

- [`application-workflows.md`](application-workflows.md), all sequence flows and
  invariants.
- [`opencode-terminal-e2e.md`](opencode-terminal-e2e.md), acceptance checks.
- [`../prototype/decisions/quick-request-manual-verification.md`](../prototype/decisions/quick-request-manual-verification.md).
- [`../.requirements.md`](../.requirements.md), product and lifecycle rules.

**Implement:**

- Resolve integration defects found by the acceptance scenarios.
- Add missing regression tests at boundaries exposed by the scenarios.
- Check accessibility, keyboard focus, terminal resize, error visibility,
  loading states, and mobile-sized/desktop-sized layout behavior where the
  Tauri window supports both.
- Verify that no UI transcript duplicates OpenCode history.
- Verify macOS-sensitive choices remain portable even though the first runtime
  target is Linux.

**Validate:**

- Run the complete automated test suite, production build, Rust tests, and
  frontend checks.
- Exercise the full Quick Request flow, two sessions sharing a directory,
  workspace planning, multi-repository task setup, partial setup failure,
  follow-up/input, task completion, cleanup, workspace completion, promotion,
  window hide/show, restart recovery, and full quit.
- Use a fresh validator subagent to compare observed behavior against every
  applicable flow in `application-workflows.md`.
- Record any remaining risk with the exact scenario and reproduction steps.

**Completion criterion:** the complete application passes the automated suite
and the end-to-end scenarios without an unresolved behavior mismatch.

## 5. Task Ledger

The orchestrator updates this table after each implementation/validation loop.
The dependency order is fixed; status is operational state only.

| ID | Task | Depends on | Status | Implementer | Validator |
|---|---|---|---|---|---|
| P-00 | Integration baseline and registration boundary | - | blocked; Quick Request manual check user-reported, other criteria open | `ses_ed1ba86c3ffeYRUVQ5Y5SH7fPY` | `ses_ed1aebbf6ffe7zWWC26F0OzS6F` |
| I-00 | Production application shell | - | user-reported updated storage-enabled Wayland verification | `ses_ed162654bffeZM7sE5C24tI7I6` | user Wayland report |
| I-01 | Management persistence and domain records | I-00 | pass | `ses_ece4eadb9ffeXLM5XymY8o1ckF`; repairs `ses_ece3b228effeuekHraUFwov69V`, `ses_ece296c35ffe8j2WPjFHbeIk4m` | `ses_ece287951ffegtI4iHGEZkdpLv` |
| I-02 | Path, repository, branch, and worktree safety | I-01 | pass; source/scope review passed; formal diff unavailable (no `.git`) | `ses_ece1ada55ffe72Uvlr1BYXhnTv`; repairs `ses_ecdf06ca0ffe5Ml2X62AkddbrO`, `ses_ecde6a18fffeqGkASRZ53w1HFZ` | `ses_ecddb766effev1RhijcCAtMmeJ` (after reviews `ses_ecdf6dee4ffeF2szkzuVX9Wx1P`, `ses_ecde900b8ffeNUZO6gQtyGgTxg`) |
| I-03 | App-owned OpenCode server/API runtime | I-00, I-01, P-00 | pending | - | - |
| I-04 | Shared terminal runtime | I-00, I-03 | pending | - | - |
| I-05 | Quick Request vertical slice | I-01, I-03, I-04 | pending | - | - |
| I-06 | Workspaces and repository catalog | I-01, I-02, I-03, I-04 | pending | - | - |
| I-07 | Task setup and registration tool | I-01, I-02, I-03, I-04, I-06 | pending | - | - |
| I-08 | Task sessions, input, and status recovery | I-04, I-07 | pending | - | - |
| I-09 | Task completion and cleanup | I-02, I-07, I-08 | pending | - | - |
| I-10 | Workspace completion, promotion, and history | I-05, I-06, I-09 | pending | - | - |
| I-11 | Application lifecycle and startup recovery | I-03, I-04, I-05, I-08, I-09, I-10 | pending | - | - |
| I-12 | Cross-feature acceptance and hardening | I-05, I-08, I-09, I-10, I-11 | pending | - | - |

The recorded P-00 validator passed historical v1 prototype and registration
evidence, but that does not establish the full current v2.0.27 integration and
registration acceptance. The user reports the requested Quick Request v2 manual
Wayland scenarios complete, but supplies no scenario-level observations; do not
promote that report to an independent validator pass or use it to close P-00.
The criteria listed in the P-00 acceptance update above remain open. P-00 does
not block I-00 or I-01, which do not depend on OpenCode; it remains an explicit
dependency of I-03 and therefore gates OpenCode-dependent production work.

The user reports completing the updated SQLite-enabled production shell's manual
Wayland verification. Record this as user-reported acceptance, not independent
validator evidence. No scenario-by-scenario observations were added to the
conversation.

I-01 implementation and fresh independent validation are complete. The first
fresh validator found path-resolution and shared-Quick-Request-directory gaps;
a repair pass also made startup storage errors visible. A subsequent standards
check found missing frontend invocation/error-mapping coverage, which received a
second repair and final fresh validation. The final validator independently
ran:

```sh
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
npm test --prefix app
npm run build --prefix app
```

All passed: 12 Rust tests, 6 frontend tests, build, and fmt check. Validation
covered both migrations, record round-trips and constraints, rollback,
project-home resolution, Quick Request shared-directory enforcement, promotion,
and completed-task reopening. A temporary validator harness also exercised a
version-1-to-2 migration and post-reopen custom-root path use; add these as
checked-in regression tests in a future persistence hardening pass. The user
later reported completing the updated storage-enabled startup's manual Wayland
verification. This remains user-reported rather than independently observed
evidence. Future implementation tasks still require one implementation
subagent followed by a fresh independent validator, and dependencies must be
respected.

I-01 added the management records and root-based path resolution; I-02 now adds
canonical containment checks and managed home creation. Neither task adds
OpenCode runtime, user-facing workflows, or management UI.

I-02 implementation and independent validation are complete. The implementation
and focused repair sessions are `ses_ece1ada55ffe72Uvlr1BYXhnTv`,
`ses_ecdf06ca0ffe5Ml2X62AkddbrO`, and `ses_ecde6a18fffeqGkASRZ53w1HFZ`. The
final fresh validator `ses_ecddb766effev1RhijcCAtMmeJ` passed after earlier
validators found and repaired invalid-root persistence, missing default-branch
checks, runtime-session cleanup gaps, and missing fail-safe fixture coverage.
The final validator independently ran:

```sh
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
npm test --prefix app
npm run build --prefix app
cargo test --manifest-path app/src-tauri/Cargo.toml i02_git_path_fixture -- --nocapture
```

All passed: 22 Rust unit tests, 1 Git integration fixture, 6 frontend tests,
build, and fmt check. The fixture reports canonical paths and repository
identity, verifies allowed/rejected binding cases and default-branch ownership,
classifies clean/dirty/in-use cleanup, and checks repeated inspections do not
change Git state. Tests cover project-root setting rejection, path traversal and
symlink escape, home ownership markers, insert rollback, and missing/ambiguous
cleanup state. Cleanup remains a planner; it removes no worktree, branch, or
file. I-02 implementation paths are `app/src-tauri/src/safety.rs`,
`app/src-tauri/src/management.rs`, and `app/src-tauri/src/lib.rs`; fixture tests
are in `app/src-tauri/tests/i02_safety_fixtures.rs`, with the fixture command
documented in `app/README.md`. GUI acceptance was not part of I-02 and was not
run.

**Residual:** this checkout has no `.git` metadata. The final independent reviewer
assessed the current source inventory and behavior against I-02, but could not
inspect a baseline diff or certify an exact changed-file set. No commit was made.

The v2 prototype adaptation was implemented by `ses_ececd00dcffewq87B2huB6VT21`,
repaired after an independent credential finding by
`ses_ececb6cd2ffeEOk56yXxu3AVUl`, and passed fresh validation by
`ses_ececaf78fffedpUlevJmJ1BEMk`. Latest prototype checks pass: 15 Rust tests,
7 frontend tests, `npm run build`, and `cargo fmt --manifest-path
src-tauri/Cargo.toml -- --check`. API smoke checks exercised model listing,
explicit-model session creation and switch (204), exact-directory readback, and
empty history without sending a prompt. The user-reported manual Wayland check
adds acceptance evidence only for the scenarios described above; it does not
resolve the remaining P-00 registration/integration criteria. Durable history
checks are deferred until production records exist.

## 6. Final Handoff Output

When the implementation sequence is complete, the orchestrator returns:

1. The final task ledger with implementation and validator subagent IDs.
2. The changed production/test paths grouped by task.
3. Automated test, build, and typecheck commands with results.
4. GUI/manual acceptance evidence for the terminal and lifecycle flows.
5. Any known residual risks, each tied to a workflow and reproduction path.
6. A concise description of the production OpenCode contract and process
   ownership actually implemented.
