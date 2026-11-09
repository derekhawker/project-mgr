# SolidJS UI Refactor Progress

## Goal and current status — selection follow-up, 24 October 2026

Deliver a runnable SolidJS frontend for the existing Tauri app, preserving its
behavior, Rust command contracts, OpenCode-owned history, and interactive
terminal lifecycle. **Most presentation has migrated; the app is not yet signed
off as ready to run.** More controller extraction is not the next milestone.

### Final extra slice — reactive Quick Request navigation selection

The user confirmed the expected recent-list behavior: opening a Quick Request
selects it, opening another moves the highlight with unchanged list records, and
selecting a Workspace clears it. This was a source-review finding, not an observed
Wayland failure.

- [x] `createQuickRequestSelection` owns the selected request as one Solid signal;
  its ID accessor feeds both persistent list destinations. All owner/controller,
  tab/terminal-owner, and restore guards read that same signal. Workspace selection
  and selected-request deletion clear it through the same setter; Quick Request
  opening/creation publish through the existing `selectQuickRequest` callback.
  No second ID cache or frontend domain rule was introduced.
- [x] Removed the obsolete recent/full-list shallow clones from both owner-selection
  functions. Selection now invalidates existing row observers directly; records,
  list roots, terminal containers, process ownership and session workflows remain
  unchanged. History/Directories destination changes still retain owner selection.
- [x] Nonvisual production-state tests subscribe once per unchanged record using
  Solid's client reactive core (`--conditions=browser` in an isolated Node process,
  no DOM). They prove initial state, opening/switching, Workspace clear, reselect
  and deletion clear invalidate subscribers, not merely that later getter reads
  return a different ID. History-controller tests use the actual signal for
  selection-before-session-display, opening another request, retained selection
  across list navigation/nonselected deletion, selected deletion, cancellation,
  rejected deletion and rejected restore.
- [x] Post-fix focused checks, from `app/`:
  `node --test test/quick-request-selection.test.js test/quick-request-history-controller.test.js test/quick-request-creation-controller.test.js test/workspace-navigation-controller.test.js test/command-contract.test.js`
  passed **56/56**. `npm test --prefix app` from the repository root passed
  **209/209**, no skips/cancellations, including existing real installed-CLI
  model-loader and Rust wire/DTO harnesses. `npm run build --prefix app` passed
  (Vite 6.4.4, 85 modules). Final post-fix validation reran both commands with
  those same results and passed `npm run tauri:build --prefix app`, refreshing
  the optimized executable with the current frontend assets. `git diff --check`
  passed after documentation edits. Exact current results are in item 7 below.
- [x] Reviewed `application-workflows.md`, the UX index, Quick Requests navigation
  specification, and README. The Quick Requests specification now records the
  confirmed highlight behavior; screen hierarchy and UX index are unchanged.
  The matrix records nonvisual selection coverage and remaining acceptance.
  README's validation record distinguishes the pre-fix baseline from
  post-fix checks; workflows, command contracts and Rust ownership
  have not changed.
- [ ] Post-fix native/Wayland acceptance: open recent requests A then B without
  refreshing records; select a Workspace; reopen and delete the selected request
  through the full list. Check the recent highlight follows/clears and terminal
  identity/input remain stable. No DOM/render/layout/terminal automation or manual
  Wayland/native IPC run occurred. Existing broader manual/provider gates remain.

**Validation scope:** the full Rust suite, Rust formatting/native debug build,
explicit installed-CLI suite and clean install below ran **before this selection
fix**. They remain the passing baseline for unchanged Rust and dependencies, not
post-fix reruns or native acceptance evidence. The post-fix frontend checks reran
their existing real installed-CLI model-loader and Rust wire/DTO harnesses, not
the separate full Rust or explicit CLI contract suites. Item 7 distinguishes that
baseline from the current frontend/native-artifact validation; it does not claim
that every command was repeated after this extra slice.

### Item 7 final-gate execution

#### Pre-selection-fix baseline

Ran from the repository root against the pre-selection-fix refactor source, using existing
caches. Node v24.20.0, npm 11.19.0, Cargo/Rust 1.98.0, installed
`/home/derekhawker/.opencode/bin/opencode` reporting `opencode v2.0.28`;
`OPENCODE_BIN` was not set. No product/Rust/test changes were needed in this pass.

| Exact command | Actual result |
|---|---|
| `npm ci --prefix app` | PASS, exit 0; installed 127 packages. Reported one high-severity audit advisory and an esbuild install-script approval warning; subsequent Vite build passed. |
| `npm test --prefix app` | PASS, exit 0; 206 passed, 0 failed/skipped/cancelled. Includes real installed-CLI model-loader and Rust wire/DTO harnesses; legacy DOM adapters are not production JSX acceptance. |
| `npm run build --prefix app` | PASS, exit 0; Vite 6.4.4 production build, 84 modules. |
| `cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check` | PASS, exit 0; no Rust formatting changes made. |
| `cargo test --manifest-path app/src-tauri/Cargo.toml` | PASS, exit 0; 180 tests (145 library + 35 integration), 0 failed/ignored; binary/doc-test targets contain 0 tests. Includes installed-CLI checks, so this whole command is not purely deterministic. |
| `cargo build --manifest-path app/src-tauri/Cargo.toml` | PASS, exit 0; native debug build. |
| `cargo test --manifest-path app/src-tauri/Cargo.toml --test opencode_cli_contract -- --nocapture` | PASS, exit 0; 7 passed, 0 failed/ignored. Separate installed v2.0.28 help/version, authenticated info/model/catalog, fixture-error and direct-server-child reap coverage; no prompt/TUI/GUI run. |
| `npm run tauri:build --prefix app` | PASS, exit 0; reran Vite then compiled optimized native release executable at `app/src-tauri/target/release/opencode-project-manager` (Rust release compilation 1m 51s). Bundling is disabled in `tauri.conf.json`; no installer/package or native launch was tested. |
| `git diff --check` | PASS, exit 0; rerun after the final documentation edits. |

All nine required automated/native-build commands passed in that pre-fix run. No required command
was skipped. Raw command logs for this run are in the temporary local directory
`/tmp/opencode/solidjs-item7/`; this checked-in ledger records their outcomes.

#### Current post-selection-fix automated gate

Reran from the repository root on 24 October 2026 with the same toolchain and
existing caches. No code or dependency changes were needed in this validation
pass; Rust source/configuration/dependencies are unchanged. The prior passing
Rust/formatting/debug-build/explicit CLI/clean-install results above remain the
baseline rather than being relabeled as post-fix runs.

| Exact command | Actual current result |
|---|---|
| `npm test --prefix app` | PASS, exit 0; 209 passed, 0 failed/skipped/cancelled. Includes the existing real installed-CLI model-loader and Rust wire/DTO harnesses, not the separate Rust CLI contract suite. |
| `npm run build --prefix app` | PASS, exit 0; Vite 6.4.4 production build, 85 modules. |
| `npm run tauri:build --prefix app` | PASS, exit 0; reran Vite (85 modules), then rebuilt the optimized native release executable in 35.81s. Current artifact: `app/src-tauri/target/release/opencode-project-manager`, embedding the post-fix frontend assets. Bundling remains disabled; no installer/package or launch was tested. |
| `git diff --check` | PASS, exit 0 after final documentation edits. |

Current build assets: `index-DSkXnvzR.js`, `terminal-runtime-DDV0bzSb.js`, and
`index-ufq3Kown.css`. Raw logs for this post-fix run are in
`/tmp/opencode/solidjs-post-selection/`. **Item 7's current automated gate is
validated; native/GUI/manual acceptance is not.** No native executable, GUI or
browser was launched.

#### Happy DOM security advisory remediation

The earlier baseline audit found `happy-dom@21.0.1` (direct development
dependency) affected by high-severity
[GHSA-834v-8h66-3h79](https://github.com/advisories/GHSA-834v-8h66-3h79),
host code execution through an unsanitized ESM import alias. The current npm audit
metadata identified `21.0.4` as the first patched version (affected through
`21.0.3`). Updated only the direct Happy DOM range from `^21.0.1` to `^21.0.4`
and its lock entry to `21.0.4`; this is a patch release within the same major and
retains the `Window` API used by the test adapters. No broad `npm audit fix` was
used. npm registry metadata reports Node `>=20` and provides a registry integrity
hash and signatures for the tarball. Installed with lifecycle scripts disabled.

Exact remediation checks, from the repository root, on 24 October 2026:

| Exact command | Actual result |
|---|---|
| `npm audit --prefix app --json` (before update) | FAIL, exit 1; one high advisory, `happy-dom@21.0.1`, affected through `21.0.3`, `fixAvailable: true`. No unrelated advisories reported. |
| `npm ci --prefix app --ignore-scripts` | PASS, exit 0; 127 packages added; npm reported 0 vulnerabilities. Lifecycle scripts were not run. |
| `npm ls --prefix app happy-dom --depth=0` | PASS; direct dependency resolved to `happy-dom@21.0.4`. |
| `npm test --prefix app` | PASS, exit 0; 209 passed, 0 failed/skipped/cancelled. |
| `npm run build --prefix app` | PASS, exit 0; Vite 6.4.4, 85 modules. |
| `npm audit --prefix app` | PASS, exit 0; 0 vulnerabilities (no remaining unrelated advisories). |
| `git diff --check` | PASS, exit 0. |

The audit finding is resolved in the current lockfile. The manual Wayland/native,
rendering, terminal, window/tray, provider, and installed coordinator-plugin
acceptance gates listed above remain open and were not run.

**Not run / still required:** manual Wayland normal launch/no-selection startup,
native IPC, JSX/rendering and sanitized-document presentation, navigation/model
controls, New-work/progress/recovery, exact session/tab restore/focus, Tools and OS
handoff, Directories picker/archive restore, terminal node/input/replay/resize/
restart/close, unload/HMR, window hide/show/tray quit and descendant cleanup.
Provider-backed prompt/streaming/follow-up/approval/input and installed coordinator
plugin execution remain unvalidated. No browser/GUI, terminal, window or tray
lifecycle automation was added or launched. Compilation and server/API tests do
not establish these outcomes. Items 1–3 retain their manual gates below; items
4–6 are source/nonvisual completion only. **The refactor is not signed off for
native use or fully complete.** Earlier slice results remain below as historical
evidence and do not substitute for this final-gate run.

The preceding audit reviewed the production entry and components, their adapters
and tests, `workspace-refactor-target.md`, `application-workflows.md`, the UX
index and screen specifications, and the integration matrix. Codesitter was
refreshed for `app/` and used for the entry outline and helper references; direct
reads/text searches covered JSX and DOM operations its JS index does not cover.
That audit changed no product code. The bootstrap slice below repairs item 1's
source wiring and shell adapter; native initialization remains unsigned off.
The Tools slice below repairs item 2's live action forwarding and publication
order. No browser, GUI, or Wayland acceptance ran in these passes.

### Item 1 implementation and execution-order review

The user confirmed normal Tauri launch with no prior selection or special
interaction: the shell should initialize, load navigation/models, and accept
navigation rather than fail JavaScript initialization. This slice used nonvisual
checks only.

- [x] Early New-work, owner-panel, Workbench/Change Review, and Tools callbacks
  deliberately forward lazily to controller actions. Pending starting-prompt
  session display and Quick Request creation's history refresh use the same
  deferred-action rule. Eager signal/dependency values remain initialized before
  their reads; Directories construction now follows navigation/Docs and all its
  destination setters. Its duplicate navigation-data dependency was removed.
- [x] `WorkbenchShell` creates `#session-tabs` before its lookup/child mount;
  Docs toolbar selection state exists before that parent mount. Reviewed the
  other parent/child roots: Right Content before destinations, New-work before
  proposal/progress children, owner panel before pending-input/terminal/form
  handles, and Directories before library/list/archive children.
- [x] Removed undeclared `commandResult` and `docsPage` dependencies; Docs uses
  only its explicit view (item 5 retires the unused DOM defaults/binding). Imported
  `createWorkspaceSession` from the production command adapter.
- [x] Terminal import/start, app subscriptions, shell/navigation/history/catalog/
  model loads, pending-input refresh, and polling now launch only after wiring
  and roots exist. Existing terminal-readiness guards remain intact.
- [x] `loadApplicationShell` writes the production `createApplicationShellView`
  signal adapter, not DOM properties. `ApplicationShellStatus` owns connection
  message/indicator, version, and `CommandResult` at the existing hidden status
  section/response-panel location, retaining IDs, labels, and classes. Terminal
  close errors update the same result signal without clearing connection state.
- [x] Read the actual entry from imports through its final startup calls,
  including factory-time versus event-time reads and initial empty component
  collections. Nonvisual binding inspection found no remaining undeclared
  application bindings or eager later-binding reads; production compilation
  resolves the import graph. These are source checks, not native execution.
- [x] Focused production signal-adapter tests cover successful no-payload
  `app_shell_info`, storage-error response, transport rejection, initial state,
  and later command-result updates. Contract inventories recognize the new
  component and lazy callback boundary; no DOM rendering test was added.
- [ ] Manual native launch on Wayland: confirm no initialization error, initial
  shell/navigation/model loading, and navigation interaction. Terminal/window/
  tray/rendering acceptance remains manual. A green build does not close this.

### Item 2 implementation — live Tools actions and automatic installation

The user confirmed the intended context: select an active Workspace, then Tools
run/install/handoff actions must reach the current controller. The audit gaps
were source findings, not an observed Wayland failure. Nonvisual regression tests
are allowed; menu rendering and terminal acceptance remain manual.

- [x] The single root mount now receives stable action forwarders that read
  `repositoryToolActions` when invoked, not the initial no-op snapshot. Updating
  actions does not remount the menu or terminal containers.
- [x] The controller registers the loaded owner's actions **before** publishing
  groups. Group publication can synchronously mount `InstallControl` and invoke
  automatic npm installation, even while the menu is hidden. First load and
  owner changes therefore use the correct callbacks and owner-specific keys.
- [x] Load responses and retained callbacks check both owner type and ID before
  changing groups or starting work. Existing run actions, handoff busy/status
  messages, install failure/retry feedback, and automatic-install behavior remain.
  `installStarted` and terminal-key maps retain their existing lifetime: reserve
  before startup, release a failed start, retain a successful start until explicit
  terminal cleanup. Terminal attachment/cleanup code is unchanged.
- [x] Nonvisual tests execute the production forwarders and controller: latest
  callbacks, synchronous install during group publication, owner changes/stale
  responses and actions, run/handoff messages, failed-start retry, and reopen
  during/after successful startup without duplicate installation. A setter seam
  invokes the install callback immediately; no DOM/component rendering is tested.
- [ ] Manual Wayland acceptance: select an active Workspace; open/reopen Tools,
  verify automatic install runs once, run npm/Make targets and each handoff, and
  confirm terminal identity/input and explicit-close behavior. Native IPC and
  terminal lifecycle are not established by these tests.

### Item 3 slice — progress composition and Workspace-list busy state

The user confirmed progress belongs after the active capture prompt, Workspace
starting prompt, or Quick Request working-directory review. This is a
presentation-ownership migration, not a fix for an observed Wayland failure.

- [x] `WorkspaceNavigation` owns `#workspace-list`, including `aria-busy`, from
  the existing controller's signal setter. Initial busy and navigation-complete
  timing are unchanged; `main.js` no longer sets the attribute.
- [x] `NewWorkDialog` composes one `SetupProgressPanel` in the active destination.
  A pure destination helper follows capture/review state, including Back with a
  retained proposal and review reopened for setup/session recovery. Closed panes
  have no progress view. IDs, accessible labels/live region, ordered rows,
  status labels, and text-only expandable detail remain unchanged.
- [x] Progress rows/visibility live in signals initialized before dialog mounting.
  Pane transitions do not clear them; existing reset, streamed-event filtering,
  row replacement/order, and recovery callbacks remain unchanged. Removed panel/
  anchor DOM lookups, reparenting, the obsolete review `progressAnchor`, and the
  separate progress-row Solid root. No terminal surface or lifecycle code changed.
- [x] Nonvisual destination-data tests and architecture contracts cover ownership;
  existing navigation-controller tests cover busy reset. No DOM/render/layout
  automation was added.
- [ ] Manual Wayland: open each New-work type over an attached terminal; check
  interpretation progress immediately below Original prompt, then below Workspace
  starting prompt or Quick Request directory review (not Model/footer). Exercise
  Back, recapture, cancel/reopen, streamed rows/details, setup/session failure and
  retry/recovery after durable-Workspace selection. Confirm exactly one progress
  list in the active pane, retained rows/details, unchanged footer/scroll behavior,
  navigation busy indication, and terminal identity/input throughout. No such
   native, provider-backed, or visual acceptance ran in this slice.

### Item 3 slice — record-owned tab selection and keyboard navigation

The user confirmed that tabs belonging to hidden owners must not participate in
Workbench keyboard navigation. Exact session/terminal behavior must remain intact;
no GUI automation is allowed. This slice completes item 3's source/nonvisual work,
not its manual acceptance gate.

- [x] `syncOwnerSessions` derives selection and visibility from the existing tab
  records and owner-selection map through `ownerSessionTabState`: remembered ID,
  selected record, then first record in insertion order. No tab DOM query,
  selected-class read, or synthetic click determines application state. Proposal
  ownership stays separate; Quick Requests keep their exact tabless selection
  while hiding every Workbench tab.
- [x] Restore retains exact owner/type filtering, missing-record exclusion,
  sequential tracked-session order, and captured preferred/open/first fallback.
  The small `restoreOwnerSessionTabs` helper invokes the remembered tool tab's
  explicit `onSelect`; a closed or foreign tool record falls back to the tracked
  session. It checks owner identity between awaits and before final selection.
  Existing `showSession` still owns exact-ID replacement, attachment, and evidence;
  no broad session/controller extraction was introduced.
- [x] Managed-tool selection now updates the owner-selection map, as OpenCode-tab
  selection already does. Close clears selection for the session's recorded owner,
  not whichever owner happens to be selected after cleanup completes. Remaining
  record selection determines fallback and last-tab status clearing; closing a
  background owner's tab does not clear another owner's status.
- [x] Keyboard membership uses explicit visible/enabled tab records, not the
  button's own `hidden` attribute. Arrow keys wrap, Home/End select endpoints,
  and focus precedes the explicit selection action. Composition, disabled targets,
  already-handled events, and unrelated keys do not select. Only active-focus
  lookup and focus itself remain DOM presentation adapters.
- [x] Nonvisual production-helper tests cover owner isolation, proposal and
  tabless Quick Request state, fallback after removal, restore order/preference,
  tool action/fallback, owner switches during both intermediate/final awaits,
  and failure propagation. Existing Quick Request history orchestration now
  explicitly asserts owner selection before showing the exact session; existing
  creation/Tools controller checks also ran. No app-render test was added.
- [ ] Manual Wayland: switch Workspaces with multiple OpenCode/tool tabs, then
  use arrows/Home/End; only the selected owner's tabs participate and focus tracks
  selection. Revisit owners to confirm the exact remembered OpenCode/tool session,
  close selected/nonselected/last tabs, and switch owner during restore/close.
  Check Quick Request pages remain tabless, proposal cleanup stays separate, and
  terminal node identity, input, replay, resize, restart, and explicit-close process
  behavior remain intact. Terminal DOM creation/visibility/attachment/cleanup was
  retained as the existing adapter exception; none of this native acceptance ran.

### Item 4 — retained hidden Quick Request form

This slice retains the hidden production form and its original create/start
workflow. It does not replace the visible New-work directory-review flow or
expose another creation action.

- [x] `createQuickRequestFormView` owns prompt and busy signals. The owner panel
  binds the exact prompt/input value, form `aria-busy`, and submit disabled state;
  busy combines with the existing model/error/terminal-failure conditions.
  `main.js` passes this view to the production handler without looking up the
  prompt, submit button, or form DOM.
- [x] The submit adapter reads the prompt and serialized model before awaiting
  terminal readiness. Native form submit/Enter/required-field wiring and the
  `isReady` guard remain. `submitQuickRequestFlow` clears through `setPrompt`
  only after exact-session display and initial-prompt acceptance, then refreshes
  the list and returns the record. A refresh failure still reports an error
  after the accepted prompt has cleared; earlier failures retain the text.
  Busy releases in `finally`; JSX retains the independent readiness conditions.
- [x] Nonvisual tests execute the production signal view, handler, flow, and
  command adapter: exact whitespace/model snapshot, terminal gate, pending busy,
  display/send/clear/refresh ordering and returned record, deferred rejection,
  invalid serialized model, create/display failures, not-ready no-op, and refresh
  failure. A rejected terminal gate with `AbortError` covers cancellation before
  commands; no new cancellation action or backend cancellation is implied.
- [x] The optional DOM fallback remains only for the existing legacy
  `bindQuickRequestForm` event-adapter tests, now explicitly labeled. Those tests
  are not production JSX acceptance. The former optional-error-setter DOM case
  moved to production signal-path error coverage; no render/GUI test was added.
- [ ] Manual Wayland/native acceptance remains open: normal New-work Quick
  Request capture/review/Back/cancel/start, model/terminal readiness and error
  feedback, exact terminal identity/input, and native form validation/keyboard
  behavior. The compatibility form remains hidden; this slice does not claim
  native exercise of it or change the visible creation workflow.

### Item 5 — production Docs parity and legacy-helper cleanup

The user confirmed normal selected-Workspace Docs should show safe Markdown/text.
The unsupported DOMPurify Document argument was a source-audit finding, not an
observed Wayland reproduction. Only nonvisual adapter/data tests ran.

- [x] `DocsPane` creates one content adapter with `document.defaultView`, the
  supported Window factory context. The adapter parses Markdown synchronously
  and exposes only sanitizer output to the deliberate HTML insertion boundary;
  text stays literal data for JSX. No unsanitized HTML fallback was introduced.
- [x] `createDocsView` is the actual production signal adapter consumed by both
  the pane and controller. Controller tests migrated off reconstructed/legacy
  DOM to this view: cached discovery, first selection, identical paths in different
  repositories, home identity, content/error/empty/loading transitions, stale
  owner and selection success/error guards, and terminal-destination signals.
  Content-adapter doubles check Window forwarding, parser/sanitizer routing and
  text bypass; they do not test sanitization or rendered safety.
- [x] Retired unused Workspace navigation, Docs, Change Review, and Tools DOM
  renderers and their render-only tests; retained command adapters and existing
  production-controller coverage. Removed Docs' obsolete DOM default and click
  binding. JSX already owns events. Retired Workspace recovery's DOM fallback
  and pass-through helper: the production creation controller now updates its
  existing review/error/action-label callbacks directly; setup/session recovery
  tests exercise those callbacks rather than a test-only duplicate view.
- [x] Retired model select population/default DOM pathway. Production and tests
  share `modelSelectorChoices`; real installed-CLI catalog, persisted-default
  Rust wire harness, command validation, loader failure, and unavailable-default
  checks remain. The retained hidden Quick Request form/legacy event adapter,
  command adapters, CLI integration, and terminal lifecycle are unchanged.
- [ ] Manual Wayland: open Docs for a normal selected Workspace; check Markdown,
  unsafe inline HTML/script/link handling, literal `.txt`, first selection and
  same-path source groups, empty/list/read errors and retry; switch owner/file
  while loading and return to the same interactive terminal. Check navigation,
  Change Review file/diff modes and empty/error states, Tools controls, Workspace
  setup/session recovery, and native model selection after retiring their old
  renderers. No rendering/security, JSX, native IPC or GUI acceptance is claimed.

### Item 6 — explicit page-lifetime resources

- [x] All existing Solid islands mount through one `createApplicationLifetime`
  owner; parent-first mount calls and stable terminal containers are retained.
  The owner holds render disposers, app event unlisteners, the status interval,
  and the terminal adapter. Teardown releases the adapter before child-first
  root disposal. Repeated startup/teardown cannot duplicate resources.
- [x] `pagehide`, Vite HMR disposal, and explicit tests are the teardown boundary.
  Navigation, hidden destinations/terminals, and native hide-to-tray do not call
  it. Late app registrations unlisten immediately; callbacks ignore disposed
  pages. A late terminal import does not construct an adapter, while an instance
  already awaiting registration is disposed immediately, including late handles.
- [x] `TerminalRuntime` previously exposed per-session `forget`, not whole-runtime
  cleanup. It now has idempotent presentation-only `dispose` and startup; partial
  listener failure releases previous registrations and remains a hard failure.
  Disposal disconnects observers, disposes xterm-owned input/protocol handlers,
  releases subscriptions, and clears frontend buffers. Attachment/replay/resize
  continuations check disposal before creating observers or focusing a terminal.
  No process cleanup, history deletion, or DB-close command is sent by teardown.
  The old page command client rejects subsequent work, including failure cleanup;
  Rust remains the process owner. Existing explicit user close/delete is separate.
- [x] Nonvisual production-owner tests use the real runtime with only external
  registration/timer/render/terminal resources substituted. They cover startup
  and teardown idempotence, reverse nested-root release, retained hidden sessions,
  timer cancellation, ignored late callbacks, pending app/runtime registration and
  import races, startup failure, and no Rust calls during or after release.
  Existing runtime failure coverage now checks partial-registration cleanup.
- [x] Rechecked bootstrap bindings and parent-first mounts after wiring: the owner
  exists before the first mount; its error callback defers signal reads; all
  controllers, collections, and signal adapters exist before `start`; terminal
  loading remains deferred and creation still awaits terminal-listener readiness.
  App event registration still begins before the subsequent command loads.
- [ ] Manual Wayland/native: normal launch, navigation and terminal-node/input
  preservation, hide/show and tray close/quit; development HMR/page reload with
  running sessions, exact-session restore, and no duplicate live subscriptions.
  No GUI, native lifecycle, terminal rendering, or HMR acceptance ran here.

### Migration inventory (source evidence, not native acceptance)

- [x] Solid/Vite dependencies and production compilation are configured in
  `app/package.json` and `app/vite.config.js`.
- [x] Destination content and visibility use JSX/signals: `right-content-shell`,
  `workbench-shell`, `no-selection`, `directories-page`,
  `quick-request-history-page`, `change-review-panel`, and `docs-pane`.
   Static window/navigation scaffolding in `index.html` is not itself migration
   debt; dynamic connection/version/result state now uses the Solid shell view.
- [x] Workspace owner fields, forms, model/repository choices, pending prompts,
  status, Quick Request Back action, and tab markup/state are represented in
  `workspace-owner-panel`, `pending-input-list`, and `session-tab-list`.
   Tab decisions now use records and explicit actions (item 3); parent-first tab
   initialization is repaired by item 1. Manual tab/terminal acceptance remains open.
- [x] Workspace/recent-request navigation, full-request search/list, Directories
  groups/library form, retained archives, proposal repositories, progress rows,
  notices, and command-result markup have Solid components.
- [x] Tools menu/groups and install/handoff feedback render through
  `repository-tools-menu`; live callback wiring and action-before-group
  publication are repaired by item 2. Manual acceptance remains open.
- [x] New-work capture/review fields, visibility, busy/error state, and events
  are signal/JSX-backed in `new-work-dialog`; menu events are in `new-work-menu`.
   Progress placement is composed in Solid (item 3 slice); visual acceptance remains
   pending. Safe callback initialization is repaired.
- [x] Async workflows have explicit command/view/session callback seams. The
  creation, history, navigation, Directories, Change Review, Tools, lifecycle,
  session-form, proposal, dialog, and pending-prompt controllers are present.
  This is useful adapter organization, not evidence that their production
  wiring executes correctly.

Rust must retain validation, durable state, filesystem/Git work, and process
ownership. Commands still go through `command-contract.js`. Frontend controllers
may adapt commands and transient presentation state; completion does **not** mean
deleting every controller or moving Rust behavior into Solid.

### Concrete remaining checklist, in priority order

1. [ ] **Production bootstrap and shell-state wiring: automated slice complete;
   manual native launch pending.** All source-level repairs and production-view
   tests above are complete. **Remaining gate:** a manual native launch completes
   initialization on Wayland; record shell/navigation/model-load results rather
   than treating compilation or legacy DOM tests as startup acceptance.
2. [ ] **Reactive Tools callback wiring: automated slice complete; manual
   menu/terminal acceptance pending.** Stable live forwarders replace the initial
   action snapshot; action-before-group publication protects synchronous
   automatic installation. Production-controller tests cover current actions,
   stale owners, install retry, and menu reopen without duplicate installation.
   **Remaining gate:** actual menu interaction and terminal lifecycle on Wayland,
   as listed above. No menu or terminal-container remount was introduced.
3. [ ] **Ordinary presentation ownership: source/nonvisual slices complete;
   manual Wayland acceptance pending.**
   **Complete in source/nonvisual checks:** `#workspace-list` busy state and
   capture/Workspace/Quick Request progress placement are Solid-owned; progress
   no longer uses DOM reparenting or a separate child root. Manual placement,
   recovery, and terminal-preservation acceptance remains pending above.
   `syncOwnerSessions`, `restoreTrackedOwnerSession`, and `closeWorkbenchSession`
   now use session/tab records and explicit actions rather than tab DOM queries,
   selected classes, synthetic clicks, or DOM-derived close status. Keyboard
   navigation uses visible/enabled records, excluding hidden other-owner wrappers.
   **Remaining gate:** the manual progress/busy and tab/terminal checks above.
   **Done when:** presentation data, not rendered DOM, determines tab selection,
   owner filtering, busy state, and progress placement; exact IDs and xterm nodes
   remain stable. Keep focus operations as presentation adapters.
4. [x] **Retain the hidden Quick Request form with Solid-owned prompt/busy
    callbacks.** Production passes `createQuickRequestFormView` to the handler;
    JSX alone owns values and enabled/busy presentation. The flow clears through
    an explicit setter after prompt acceptance and before refresh, preserving
    exact text/model, startup-failure retention, command contracts and records.
    Source/nonvisual work is complete as recorded above; native form and visible
    New-work/terminal acceptance remain manual, not established by these tests.
5. [x] **Production Docs/adapter parity and legacy-helper cleanup: source/nonvisual
   slice complete.** `DocsPane` supplies a supported Window to the shared content
   adapter; production signal/controller tests preserve first selection, cache,
   stale-load guards and error/empty rules. Unused renderers/defaults and duplicate
   render-only tests are retired; command adapters, real CLI coverage, and hidden
   compatibility form remain. Rendering/security presentation and native behavior
   remain manual checks as listed above, not established by adapter tests.
6. [x] **Make frontend resource lifetime explicit: source/nonvisual slice complete.**
   Deliberate persistent islands share one page-lifetime owner for render
   disposers, async unlisteners, polling, and terminal-adapter release. Startup
   and teardown are idempotent; late registrations/imports are guarded. Navigation
   and hiding do not dispose sessions; teardown sends no process/history cleanup.
   Native unload/HMR and Wayland terminal/window/tray acceptance remain manual as
   listed above. Rust remains the process owner.
7. [x] **Record final automated/native-build validation and documentation gates.**
    **Current automated gate validated:** post-fix frontend tests (209), Vite,
    Tauri release rebuild with current embedded assets, and whitespace checks
    passed. All nine original commands passed in the pre-fix baseline; unchanged
    Rust/formatting/debug-build/explicit CLI/clean-install results retain that
    historical scope. Exact results and the current artifact are recorded above.
   README/UX/workflow/matrix review is recorded below; matrix and README distinguish
   current coverage from native/provider/manual gaps. No unrelated historical
   Workspace/Task specification rewrite was made. **This checks off gate execution
    and reporting, not full feature acceptance:** the high-severity Happy DOM
    advisory has been resolved by the narrow `21.0.4` patch update and the current
    npm audit is clean. All manual Wayland/native/provider gates remain open. A green
    build does not prove startup.

### Deliberate imperative adapters (not unfinished Solid rendering)

- **xterm:** terminal-surface creation/lookup, stable container identity,
  attach/replay/select/refit/focus, visibility, restart, and removal after explicit
  close belong at the terminal adapter boundary. Never make reactive list
  replacement recreate attached xterm nodes. Rust owns PTYs/processes; navigation
  only hides presentation. This exemption does not include deriving tab state
  from DOM classes or clicking tabs to select sessions.
- **Native UI:** `dialog.showModal()/close()`, native `open` reads, prompt focus,
  backdrop targeting, directory picker, confirmation, browser-owned details
  toggling, and keyboard focus are valid presentation adapters. Solid owns their
  ordinary labels, values, classes, errors, and enabled/visible state. Progress
  panel reparenting is not a native-dialog requirement.
- **Sanitized HTML:** Docs' deliberate sanitized Markdown insertion is a view
  boundary, not a reason to recreate the rest of the reader imperatively.

### Legacy helper inventory

| Path | Current production role / remaining decision |
|---|---|
| `workspace-navigation-ui.js` | Retired with its render-only test; JSX navigation remains production; controller tests cover count/selection data, manual checks cover labels/icons. |
| `change-review-ui.js`, `repo-tools-ui.js` | Production command adapters retained; unused renderers and render-only tests retired. Controller/command checks are not JSX acceptance. |
| `docs-ui.js`, `docs-controller.js` | Command adapters/controller retained; DOM renderers/defaults/click binding retired. Tests run production `createDocsView`; `DocsPane` uses the Window-bound content adapter. Routing doubles are not security-render acceptance. |
| `workspace-creation-ui.js` | Retired fallback/pass-through helper and its tests; production creation controller directly updates existing recovery view callbacks, tested nonvisually. |
| `model-selector.js`, `shell.js:populateModelSelector` | Population helper/DOM pathway retired. Production view callbacks use shared choice data; tests preserve real installed-CLI and Rust wire evidence without DOM rendering. |
| `quick-request-form.js`, `shell.js:submitQuickRequestFlow` | Retained hidden production form uses the Solid prompt/busy view and explicit clear setter (item 4). DOM value/disabled fallback is used only by legacy `bindQuickRequestForm` event-adapter tests; it is not production JSX evidence. |
| `shell.js:loadApplicationShell` | Production signal-view path; `shell.test.js` executes the actual adapter without DOM rendering (item 1 automated slice complete). |
| `error-events.js` | Production calls `showCleanupError` without an element and sends returned text to a signal; optional DOM helpers are not current production presentation writes. |

### Validation gates and exact commands

**Item 7 documentation review:** read `AGENTS.md`, this final gate list,
`app/README.md`, `application-workflows.md`, `workspace-refactor-target.md`, the
UX index and all seven listed screen specifications, `gui-testing.md`,
`opencode-terminal-e2e.md`, and the integration matrix. Rechecked production
bootstrap/launch wiring, page-lifetime ownership, retained hidden form, and Docs'
sanitized-HTML boundary against those descriptions. Codesitter's refreshed
frontend index supplied entry/lifetime outlines; direct reads covered JSX and
test/configuration boundaries. The installed-CLI contract suite has no ignored
tests and needs no extra feature flags. Only the Node harness binaries need
`integration-test-harnesses`, supplied by their existing tests.

README now describes actual startup's independent shell/navigation/model loads
and current Workspace session routing rather than the old Task-only setup
paragraph. The matrix distinguishes real installed-CLI checks from deterministic
fixtures without pinning the installed patch version. This validation pass
changes documentation, not intended product behavior, screen hierarchy, copy,
command contracts, or Rust process/history ownership. No UX/index edit is needed;
historical Task wording in superseded specifications is deliberately retained,
with `workspace-refactor-target.md` authoritative. Manual native/Wayland and
provider-backed acceptance remain open; source review and compilation cannot
close them.

**Run in the resource-lifetime slice:** from `app/`,
`node --test test/application-lifetime.test.js test/terminal-runtime.test.js test/command-contract.test.js`
passed (60 tests); `npm test` passed (206 tests, no skips), including existing
installed-CLI model-loader and Rust wire/DTO harness checks; `npm run build`
passed. A Babel scope inspection found no unexpected unresolved entry bindings;
factory-time versus deferred reads and parent-first mounts were also reviewed
in source. `git diff --check` passed. New tests are nonvisual resource-ownership
checks using the real runtime's registration/disposal, not JSX/terminal/native
lifecycle automation. No full Rust suite, native build/IPC, installed-server
CLI contract suite, provider-backed flow, HMR acceptance, GUI automation, or manual
Wayland/window/tray/terminal acceptance ran in that resource-lifetime slice.
Item 7's later gate results are recorded above; manual acceptance remains open.

**Run in the Docs/cleanup slice:** from `app/`,
`node --test test/docs-ui.test.js test/docs-controller.test.js test/doc-content.test.js test/change-review-ui.test.js test/repo-tools-ui.test.js test/workspace-creation-controller.test.js test/command-contract.test.js test/model-loader-integration.test.js`
passed (63 tests); `npm test` passed (201 tests, no skips); `npm run build`
passed. `git diff --check` passed. Focused and full suites retain the real
installed-CLI model-loader and Rust wire/DTO harness checks. New tests are
nonvisual production signal/controller/choice data and content-routing checks;
the sanitizer/parser doubles do not establish actual sanitization. Retired DOM
render-only tests account for the lower full-suite count; unchanged legacy
event/terminal adapter tests still run. No new DOM/render/GUI automation, full
Rust suite, native build, native IPC, explicit installed-server CLI contract
suite, provider-backed flow or manual Wayland/security acceptance ran here.

**Run in the retained Quick Request form slice:** from `app/`,
`node --test test/quick-request-form.test.js test/quick-request-form.integration.test.js test/shell.test.js test/form-keyboard.test.js test/command-contract.test.js`
passed (107 tests); `npm test` passed (211 tests, no skips), including the
existing Rust DTO/model-loader harness checks and legacy DOM-adapter tests;
`npm run build` passed. `git diff --check` passed. New tests are nonvisual
production signal/submit-adapter checks, not GUI/render automation. No full Rust
suite, native build, native IPC, installed-server CLI contract, provider-backed
flow, or manual Wayland acceptance ran in this slice.

**Run in the tab-state slice:** from `app/`,
`node --test test/session-tab-state.test.js test/session-tab-keyboard.test.js test/quick-request-history-controller.test.js test/workspace-creation-controller.test.js test/repository-tools-controller.test.js test/command-contract.test.js`
passed (67 tests); `npm test` passed (204 tests, no skips), including the existing
Rust DTO/model-loader harness checks and legacy DOM-adapter tests;
`npm run build` passed. `git diff --check` passed. New tab checks use production
records/helpers and plain event/focus callbacks, not rendered application DOM.
No full Rust suite, native build, native IPC, provider-backed flow, browser/GUI
automation, or manual Wayland acceptance ran in this slice.

**Run in the progress/busy slice:** from `app/`,
`node --test test/new-work-progress.test.js test/new-work-proposal-review.test.js test/workspace-navigation-controller.test.js test/command-contract.test.js`
passed (52 tests); `npm test` passed (196 tests, no skips), including the existing
Rust DTO/model-loader harness checks and legacy DOM-adapter tests;
`npm run build` passed. No new DOM/render/layout automation was added. No full
Rust suite, native build, native IPC, provider-backed flow, or manual Wayland
acceptance ran. `git diff --check` passed.

**Run in the Tools slice:** from `app/`,
`node --test test/repository-tools-controller.test.js test/command-contract.test.js`
passed (52 tests); `npm test` passed (194 tests, no skips), including the existing
Rust DTO/model-loader harness checks; `npm run build` passed. `git diff --check`
passed. No new GUI/DOM-rendering test was added. No full Rust suite, native build,
native IPC, or manual Wayland menu/terminal acceptance ran in this slice.

**Run in the bootstrap slice:** from `app/`,
`node --test test/shell.test.js test/command-contract.test.js` passed (92 tests),
`npm test` passed (190 tests, no skips), and `npm run build` passed.
The full suite included its existing Rust DTO/model-loader harness checks and
legacy DOM adapter tests; no new DOM rendering automation was added. A nonvisual
binding inspection supplemented the manual entry-order review. `git diff --check`
passed. No full Rust suite, native build, browser/GUI, or manual native launch ran
in this slice; item 1 remains open only for its manual launch gate.

**Run in this audit:** `npm test` from `app/` passed (190 tests, no skips),
including existing Rust DTO/model-loader harness integration; `npm run build`
passed; `git diff --check` passed before and after the documentation edit. These
checks do not execute `main.js` as the native entry: many UI checks inspect source text
or exercise legacy DOM adapters. No full Rust suite, native build, or manual
launch is claimed by this audit.

Bootstrap-slice commands, from `app/`:

```sh
node --test test/shell.test.js test/command-contract.test.js
npm test
npm run build
```

The shell's production view-adapter tests now cover success/storage failure/
rejection without automated visual/rendering tests. Binding order received an
explicit source review; native startup still requires manual launch. The selector
inventory alone establishes neither.

Final automated/native-build gates, from the repository root:

```sh
npm ci --prefix app
npm test --prefix app
npm run build --prefix app
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo build --manifest-path app/src-tauri/Cargo.toml
cargo test --manifest-path app/src-tauri/Cargo.toml --test opencode_cli_contract -- --nocapture
npm run tauri:build --prefix app
git diff --check
```

The explicit CLI contract command starts the installed OpenCode server and must
be recorded separately from deterministic tests; `OPENCODE_BIN` may be needed.
The Tauri build uses the Vite build and currently has bundling disabled in
`tauri.conf.json`. Compilation is available without claiming GUI acceptance.

**Manual only, on the target Wayland desktop:** from `app/`, run
`npm run tauri:dev` (or run the built native executable). Check initial shell and
startup errors; Workspace/Quick Request navigation and model loading; New-work
capture/review/back/cancel/retry and progress placement; zero/one/multi-repository
session startup and exact tab restore; owner-tab keyboard focus; Tools automatic
install/run/handoff; Directories picker/toggle/library/archive restore; Docs
Markdown/text and failure states; Change Review file selection/diff modes;
terminal node/input/resize preservation across destinations; close/restart;
window hide/show, tray quit, and child cleanup. Provider-dependent prompt/input
flows require a configured live model. Record compositor, actions, outcomes,
and any occlusion. No browser/GUI automation is added or implied.

**Documentation review:** reviewed `application-workflows.md` startup/recovery,
the UX index, No selection, and Workspace workbench specifications, and
`app/README.md`. This repair changes initialization and presentation ownership,
not intended workflow, copy, screen hierarchy, or terminal lifetime; no UX
specification/index change is needed. README records the new startup signal seam
and manual gate. The integration matrix now distinguishes shell adapter execution
from native launch; legacy DOM coverage elsewhere remains non-native evidence.
`workspace-refactor-target.md` remains authoritative where historical Task wording
differs.

### Workbench shell layout regression — 24 October 2026

- [x] Fixed shell mount-point wrappers that interrupted the flex layout: the
  Workbench, right-content, destination and owner-panel mounts now expose their
  rendered children to their intended flex parents. The right content is bounded
  to the remaining viewport height and can shrink without extending below the
  window; terminal flex sizing remains intact.
- [x] Session tabs now render their presentation items directly into the tablist
  rather than under an extra wrapper. Keyboard handling stays on the tablist and
  retains the existing Arrow/Home/End behavior and ARIA tab roles/relationships.
- [x] The New work mount wrapper no longer interrupts navigation flex layout, so
  its existing auto margin pins it to the bottom independently of list length.
- [x] Authorized Chromium/Vite checks used a seeded presentation fixture with
  three labeled session tabs and a terminal surface (no terminal transcript) at
  720x560 and 1000x720. The right pane and owner reached the viewport bottom,
  terminal stayed inside the window, all tab items shared one row, New work sat
  at the navigation bottom, and document overflow was false at both sizes.
  Screenshots: `/tmp/opencode/layout-720x560.png` and
  `/tmp/opencode/layout-1000x720.png`. This validates Chromium layout only.
  Native Wayland visual acceptance remains open.
- [x] Reviewed `application-workflows.md`, the UX index, and
  `screen-workspace.md`. This repairs the existing full-height terminal, compact
  session tab bar, and bottom-pinned navigation contract without changing product
  workflows; no UX specification change is needed. The matrix records the visual
  verification and Wayland acceptance gaps separately.

**Tools-slice documentation review:** reviewed `application-workflows.md` Tools
handoff, the UX index and `screen-workspace.md`, and `app/README.md`. This repairs
callback wiring and synchronous presentation-adapter ordering, not intended
behavior, copy, layout, screen hierarchy, or terminal lifetime. No UX/index or
README change is needed. The integration matrix now records nonvisual production
Tools action/order coverage separately from legacy rendering and manual native
acceptance.

**Tab-state-slice documentation review:** reviewed `application-workflows.md`
exact-session restore, Tools, and hide/reopen workflows, the UX index,
`screen-workspace.md`, and `app/README.md`. Workbench now explicitly records the
confirmed selected-owner keyboard behavior. Copy, screen hierarchy, command
contracts, process ownership, and terminal lifetime are unchanged; no index or
README update is needed. The integration matrix separates nonvisual tab/restore
and existing controller coverage from manual native terminal/focus acceptance.

**Retained Quick Request form documentation review:** reviewed
`application-workflows.md`, the UX index, `screen-quick-requests.md`,
`screen-new-work.md`, and `app/README.md`. This changes presentation ownership,
not intended copy, hierarchy, directory-review creation, persistence, command
contracts, or terminal lifetime; the compatibility form remains hidden. No UX
specification/index or README change is needed. The integration matrix now
separates production signal-form coverage from legacy DOM binding tests and
manual native validation/terminal acceptance.

**Docs/cleanup documentation review:** reviewed `application-workflows.md` Docs,
the UX index, `screen-docs.md`, and `app/README.md`. Intended safe Markdown/literal
text, list/first-selection/error/empty behavior, screen hierarchy, workflows,
Rust ownership and terminal lifetime are unchanged, so no Docs spec or UX index
edit is needed. README and integration matrix now distinguish production
signal/controller/content-routing and live CLI/data tests from JSX/native and
rendered-security acceptance; the helper inventory records each retirement.

**Resource-lifetime documentation review:** reviewed `application-workflows.md`
startup, hide/reopen, window/tray and shutdown contracts, `opencode-terminal-e2e.md`
ownership/startup/lifecycle guidance, the UX index, Workbench specification, and
`app/README.md`. Intended workflows, screen hierarchy, copy, process/history
ownership, and hide-to-tray behavior do not change; no UX/index edit is needed.
README documents the page owner, runtime cleanup contract and manual boundary.
The integration matrix distinguishes nonvisual release/race coverage from actual
native unload/HMR, rendering, terminal, window/tray and shutdown acceptance.

## Historical slice notes

**Progress/busy-slice documentation review:** reviewed `application-workflows.md`,
the UX index, New-work and Quick Requests/navigation specifications, and
`app/README.md`. Intended copy, hierarchy, workflows, and terminal lifetime are
unchanged. New-work now explicitly records the confirmed Quick Request review
progress location; the index and README need no change. Integration-matrix rows
separate destination-data/ownership checks from pending manual Wayland placement,
streamed-progress/recovery, navigation, and terminal-preservation acceptance.

The notes and validation log below are retained evidence of earlier slices,
not a cumulative statement that production startup or manual acceptance passed.
Statements about what remained in `main.js` describe their individual slice.

Workspace navigation data and attached-repository row adaptation now live in
`app/src/workspace-navigation-controller.js`. `main.js` retains selection
decisions, Change Review workflow, `loadWorkspaceNavigation`, and session
lifecycle through explicit getters/callbacks. The adapter updates the existing
Solid signals and navigation data reference, preserving verified-only repository
counts, selected Workspace/Quick Request behavior, `aria-busy` reset, repository
labels/checkout paths, and catalog-name fallback. Production adapter tests cover
selection states, repository counts/list rendering, and fallback. No UX behavior
changed, so UX specifications require no update.

Quick Request confirmation orchestration now lives in
`app/src/quick-request-creation-controller.js`; `main.js` keeps the Workspace
branch and dispatch. The controller preserves the original prompt, parsed model,
selected repository ID/null, terminal readiness check, and the existing
`submitResolvedQuickRequestFlow` contract. Session display, navigation selection,
request refresh, and proposal/dialog lifecycle are explicit dependencies. It
retains owner-created recovery, Quick Request/workspace fallback selection,
busy/finally cleanup, and duplicate-creation guards. Focused production tests
cover arguments, callback ordering, no-op guards, and failure cleanup. No UX
behavior changed, so the Quick Requests and New-work specifications require no
update. Validation: `npm test`, `npm run build`, and `git diff --check`.

Pending starting-prompt submission now lives in
`app/src/pending-starting-prompt-controller.js`. `main.js` retains session and
terminal lifecycle through the `showSession` callback and supplies signal/state
adapters. The pending-action guard, exact text handling, command contract,
action-specific status, success-only reset, retry behavior, and disabled
`finally` cleanup are preserved. Production-controller tests cover no action,
blank input, both action types, display/command failures, and busy recovery. The
New-work and Workspace Workbench UX specifications require no behavior change.

Workspace confirmation orchestration now lives in
`app/src/workspace-creation-controller.js`; Quick Request confirmation remains
in `main.js`. The controller receives explicit command, proposal, navigation,
session-display, progress, recovery, and UI-state dependencies. It retains
durable-owner retry handling, transient starting-prompt submission, and terminal
lifecycle callbacks. Quick Request remains on the shared main.js handler. The
Workspace controller owns its busy/error initialization and `finally` cleanup,
so its retry recovery can re-enable creation without the former outer handler
overwriting `ownerCreated`. Focused production tests cover successful prompt
submission, setup recovery, pre-owner command rejection, and post-owner failure.
The New-work UX specification requires no behavior change. Validation passed:
`npm test`, `npm run build`, and `git diff --check`.

New-work proposal-to-review-state preparation now lives in
`app/src/new-work-proposal-review.js`. It retains Workspace/Quick Request
validation, review labels and details, original/starting prompt semantics,
repository-location presentation adapter use, Quick Request default directory
selection, and the progress-panel anchor decision. `main.js` keeps DOM mounting
and reparenting, Solid signal updates, asynchronous directory resolution, and
proposal-session lifecycle via explicit orchestration. Focused production-helper
tests cover both supported work types and rejection of an invalid type. The
New-work UX specification describes no behavior change.

Enter-to-submit behavior for New-work capture, Workspace session, and Quick
Request forms now binds through Solid JSX `onKeyDown` handlers. The shared
`handleEnterToSubmit` preserves composition, Shift+Enter, editable-textarea,
disabled-submitter, and native validity/requestSubmit behavior; `main.js` no
longer installs imperative keyboard listeners. Focused tests exercise production
event behavior and guard the component binding boundary.

Workspace session-form submission now lives in
`app/src/workspace-session-form-controller.js`. It preserves form prevention,
readiness/selection guards, exact prompt/model command values, busy-state
transitions, status/error formatting, and show-session-before-success ordering;
terminal/session lifecycle remains in `main.js`. Focused tests cover the real
command adapter and controlled callback failures. The Workspace Workbench UX
specification requires no behavior update.

Workspace Complete/Reactivate command orchestration now lives in
`app/src/workspace-lifecycle-controller.js`. `main.js` retains selected-workspace
state and supplies explicit status, refresh, and reselection callbacks. Lifecycle
guards, command adapters/payloads, messages, error formatting, and refresh-then-
reselect ordering are unchanged. Focused tests exercise the production controller;
the Workspace Workbench UX specification requires no behavior update.

Quick Request history record workflows (`refreshRequests`, opening, confirmed
deletion, and full-list navigation) now live in
`app/src/quick-request-history-controller.js`. It receives command adapters,
state accessors, signal setters, and explicit terminal/navigation callbacks;
session and xterm lifecycle orchestration remains in `main.js`. Filtering,
messages, ownership checks, and command payloads are unchanged. Focused tests
exercise the production controller. No UX behavior changed, so the Quick
Requests UX specification requires no update. Validation: `npm test`,
`npm run build`, and `git diff --check` passed.

### Repository Tools and related slices

Repository Tools opening/loading and action callback creation now live in
`app/src/repository-tools-controller.js`. `main.js` supplies owner/state setters,
terminal lifecycle, and OS handoff callbacks explicitly; Tauri and terminal
ownership remain in the adapter. Owner identity protection, load errors, disabled
timing, action messages, and duplicate-install prevention are preserved. Focused
production-controller tests cover close/no-owner, load success/error, stale
owners, disabled cleanup, handoff errors, and install duplicate/failure behavior.
No UX behavior changed; the Workbench UX specification requires no update.

Change Review destination transitions, availability synchronization, Docs
availability refresh, and load orchestration now live in
`app/src/change-review-controller.js`. Solid setters and the Docs controller
remain explicit dependencies; `main.js` retains command-adapter wiring and
terminal lifecycle ownership. Existing availability rules, owner identity stale
response guard, messages, and loading/error/disabled signals are preserved.
Production-controller tests cover unavailable guards, successful loading, stale
owner responses, and failure/finally cleanup. No UX behavior changed; the
Change Review specification requires no update. Validation: `npm test`,
`npm run build`, and `git diff --check`.

Directories/repository-library orchestration now lives in
`app/src/directories-controller.js`: repository directory add/scan and refresh,
catalog refresh, workspace attachment, library path choose/save, destination
show/return, archive refresh/restore, and startup scanning. The module receives
invoke, picker, workspace/navigation accessors, refresh callbacks, and explicit
Solid setter dependencies. `main.js` now delegates these actions; components
remain responsible for rendering. Command adapters and workflow outcomes are
unchanged. Validation: `npm test`, `npm run build`, and `git diff --check` passed.

The startup `#command-result` paragraph now renders from a Solid signal at the
same response-panel location, retaining its ID, class, and initial text. Proposal
and workbench terminal-close failures update that signal; command execution,
cleanup, owner status, and session lifecycle are unchanged. Architecture coverage
guards the initial contract, Solid binding, both setter updates, and absence of
direct text writes.
Validation: `npm test` passed (148 tests), `npm run build` passed, and
`git diff --check` passed. Visual/native acceptance remains manual on Wayland.

The Workspace owner's `proposal-mode` class is now bound by `WorkspaceOwnerPanel` to a Solid signal. Proposal session identity checks use the same accessor, and Workspace/Quick Request selection plus proposal cleanup reset it; proposal runtime and session lifecycle behavior are unchanged.

### Workspace prompt and related slices

The Workspace planning prompt textarea `#workspace-prompt` is now controlled by
a Solid signal in `WorkspaceOwnerPanel`; its existing submit callback passes the
signal's exact value (including an empty string) to `createWorkspaceSession`.
Placeholder, label, validation timing, model choice, and controller-owned session
orchestration are unchanged. This planning prompt remains separate from original
and starting prompts. A contract test guards the Solid binding and value path.
Validation: `npm test` passed (146 tests), `npm run build` passed, and
`git diff --check` passed.

New-work capture orchestration now lives in `app/src/new-work-proposal-controller.js`.
It preserves original-prompt validation, progress and busy/error transitions,
prior proposal cleanup, Quick Request catalog refresh, selected-model parsing,
proposal command ordering, and review handoff. `main.js` retains Solid mutations
and the proposal-session close implementation through callbacks; the
request/response-only proposal session is still excluded from terminal registry
ownership. Focused tests exercise the production controller's guards, ordered
success, failures, and busy recovery. The New-work UX specification requires no
behavior update.

Directories repository feedback now flows through a Solid signal consumed by `DirectoriesPage`; production `main.js` no longer writes `#repository-status` text directly. Opening errors, repository toggles, add/scan progress and results, and legacy archive restore retain their messages and timing. Workflow/controller logic is unchanged.

The New-work capture `#new-work-prompt` value is now Solid-owned. The dialog binds its value and input event while retaining the required field, placeholder, and labels; opening New work resets the signal at the existing point. Capture validation and both proposal and Quick Request paths read the signal, preserving the exact original prompt independently of the editable Workspace starting prompt. Async proposal/controller ownership and retry behavior are unchanged.

The `#right-content` wrapper and its existing child mount roots now render through `RightContentShell`. Its `owner-active` and `quick-request-terminal-page` classes are driven by Solid signals set at the existing controller transitions; routing and workflow decisions remain in `main.js`. Child-root nesting/IDs and terminal DOM ownership are preserved. Selector coverage checks the Solid class bindings and guards against direct controller writes.

Workspace attach-repository and session-submit disabled presentation now flows through `WorkspaceOwnerPanel` props/signals. The controller retains Workspace selection, model-readiness decisions, and submission workflow; busy/finally updates use setters. Quick Request visibility and controls are unchanged.

Validation: `npm test`, `npm run build`, and `git diff --check` passed. Wayland visual/native acceptance remains manual.

The New-work capture-pane `#new-work-error` alert now renders its message from a
Solid signal. Opening the dialog and starting a capture/retry clear the signal;
proposal-capture failures set the same formatted message as before. The
proposal-error recovery helper and async workflow remain unchanged. The New-work
UX specification describes no behavior change.

The editable pending **starting prompt** value and submit-button busy/disabled
state now belong to `WorkspaceOwnerPanel` signals. Submission reads the exact
signal text (using trimming only to reject empty input), preserves the existing
status/error and retry behavior, and on success clears the editor, clears the
pending action, and hides the section. This remains distinct from the New-work
original-prompt capture and proposal starting-prompt value.

New-work dialog interaction orchestration now lives in
`app/src/new-work-dialog-controller.js`. It preserves accepted work types,
requested type, signal reset timing, native dialog lifecycle, prompt focus,
Escape prevention, backdrop targeting, proposal-session cleanup failure behavior,
and the review-to-capture transition. Solid setters, dialog methods, focus, and
proposal cleanup are explicit callbacks; proposal creation remains outside.
Focused production-controller tests cover open validation, cancellation and
cleanup failure, Escape/backdrop, and Back. No UX behavior change is intended;
the New-work UX specification requires no update. `app/test/command-contract.test.js`
guards that `main.js` wires the exported dialog actions and Solid setters to the
controller; production behavior tests cover valid/invalid open, Escape
`preventDefault`, backdrop target matching, Back-to-capture with focus, cancel
closing after successful cleanup, and remaining open when cleanup rejects.
Validation passed: `npm test` (all tests), `npm run build`, and
`git diff --check`.

## Historical validation log

- Initial test/build attempt failed because `node_modules` was absent.
- `npm ci` completed from the checked-in lockfile.
- Baseline before code changes: `npm test` passed (121 tests); `npm run build`
  passed.
- After Solid integration and Workspace navigation migration: `npm test` passed
  (121 tests); `npm run build` passed.
- After migrating Directories and Quick Request list rendering: `npm test` passed
  (121 tests); `npm run build` passed.
- After migrating session-tab control rendering: `npm test` passed (121 tests);
  `npm run build` passed.
- After migrating Change Review content: `npm test` passed (121 tests);
  `npm run build` passed.
- After migrating Docs and repository-tools content: `npm test` passed
  (121 tests); `npm run build` passed.
- After migrating archived-record list rendering: `npm test` passed (121 tests);
  `npm run build` passed.
- After migrating the New-work type dropdown: `npm test` passed (121 tests);
  `npm run build` passed.
- After moving the Workspace owner-panel structure to `app/src/workspace-owner-panel.jsx`:
  `npm test` passed (121 tests); `npm run build` passed.
- The Workspace owner header/status/repository rows are now signal-driven, and
  proposal repository rows are rendered with Solid.
- After signal-driving owner summary/status and migrating proposal repository
  list rendering: `npm test` passed (121 tests); `npm run build` passed;
  `git diff --check` passed.
- App recovery/startup notices were moved to a Solid-rendered signal component;
  session status announcements also use a Solid-owned signal within the owner
  panel.
- After migrating app notices and session-status rendering: `npm test` passed
  (121 tests); `npm run build` passed; `git diff --check` passed.
- New-work capture/review pane visibility is now controlled by a Solid view-state
  signal; dialog lifecycle and asynchronous proposal handlers remain controller-
  owned.
- After migrating New-work pane visibility: `npm test` passed (121 tests);
  `npm run build` passed; `git diff --check` passed.
- Pending starting-prompt visibility, enabled state, and action label are now
  signal-driven in the Solid owner panel.
- Pending-input rows and their error message now render through a Solid list;
  session navigation remains a callback into the session controller.
- Session restart availability and in-progress state now update the tab through
  Solid signals instead of mutating the restart button directly.
- Quick Request versus Workspace owner-management control visibility is now
  signal-driven in the Solid owner panel.
- New-work type-specific title/guidance now render from the selected work type
  signal rather than imperative text assignments.
- An architecture assertion now checks the Solid-owned copy source instead of
  expecting static text in JSX output.
- After migrating type-dependent New-work copy: `npm test` passed (121 tests);
  `npm run build` passed; `git diff --check` passed.
- After migrating owner-control visibility: `npm test` passed (121 tests);
  `npm run build` passed; `git diff --check` passed.
- New-work capture and back events now bind in the Solid dialog component.
- New-work cancel, Escape, and backdrop events now bind in the Solid dialog.
- Proposal confirmation and Quick Request directory changes now bind in Solid.
- The full-history New Quick Request action and terminal-page Back action now
  bind through Solid components instead of separate DOM listeners.
- After migrating Quick Request heading/back actions: `npm test` passed
  (121 tests); `npm run build` passed; `git diff --check` passed.
- Pending starting-prompt submission now enters through a Solid owner-panel
  event prop; session selection and prompt command remain in the controller.
- Workspace session form submission now binds in the Solid owner panel; Rust
  session creation, model selection, and terminal attachment remain in callbacks.
- Quick Request form submission now binds through the Solid owner panel while
  preserving the tested production submit-handler adapter.
- Quick Request directory options, selection, and resolution feedback now flow
  through Solid signals; the directory-resolution adapter still runs in the
  controller.
- Session-tab visibility, selection styling, ARIA state, and keyboard tab stop
  now derive from Solid tab records; the controller still chooses the exact
  session ID and instructs xterm which session to display.
- Proposal review title, conditional sections, initial editable values, and
  confirmation label now derive from a Solid proposal-view record. Workspace
  name and starting-prompt edits are Solid signals consumed by the existing
  confirmation callback.
  Workspace name and starting-prompt edits now use Solid signals, initialized
  whenever a proposal is rendered; confirmation consumes those signals rather
  than reading the input DOM. Original-prompt and Quick Request behavior remain
  unchanged.
- After migrating Quick Request directory state and session-tab presentation:
  `npm test` passed (121 tests); `npm run build` passed;
  `git diff --check` passed.
- Proposal review presentation is now signal-driven; its former DOM-only
  visibility assertion was updated to verify the component's Solid condition.
- After migrating proposal review presentation: `npm test` passed (121 tests);
  `npm run build` passed; `git diff --check` passed.
- Change Review's heading/summary, Back action, and Unified/Split controls now
  render and handle events in its Solid component. Page visibility and the
  controller's data-loading lifecycle remain unchanged.
- After migrating Change Review header/actions: `npm test` passed (121 tests);
  `npm run build` passed; `git diff --check` passed.
- The full New-work entry point, proposal review, and Workspace/Quick Request
  form submit events now bind through Solid components. Rust command contracts,
  asynchronous setup, and the reviewed form-value read remain in existing
  controller/service boundaries.
- The Directories page heading and repository-library location form now render
  through `app/src/directories-library-form.jsx`; path, save status, and saving
  state use Solid signals. Picker/save/add-directory workflows remain callbacks
  into the controller, while repository data and page visibility remain
  controller-owned. The UX spec requires no behavior change for this migration.
- After moving Workspace session and Quick Request form submits to Solid event
  props: `npm test` passed (121 tests); `npm run build` passed;
  `git diff --check` passed.
- After migrating New-work and Quick Request action event bindings: `npm test`
  passed (121 tests); `npm run build` passed; `git diff --check` passed.
- After migrating New-work confirmation and directory-change bindings:
  `npm test` passed (121 tests); `npm run build` passed;
  `git diff --check` passed.
- After migrating the Directories heading and repository-library form:
  `npm test` passed (121 tests); `npm run build` passed;
  `git diff --check` passed.
- After moving New-work cancel/Escape/backdrop handlers into Solid: `npm test`
  passed (121 tests); `npm run build` passed; `git diff --check` passed.
- After Solid session-restart state updates: `npm test` passed (121 tests);
  `npm run build` passed; `git diff --check` passed.
- Preserved the New-work dropdown's close-before-open behavior in its Solid
  component rather than leaving the menu expanded behind the dialog.
- After migrating pending-input rendering and preserving menu dismissal:
  `npm test` passed (121 tests); `npm run build` passed; `git diff --check` passed.
- After migrating pending-input rendering: `npm test` passed (121 tests);
  `npm run build` passed; `git diff --check` passed. One architecture assertion
  was updated to recognize the new Solid-owned list boundary.
- A Docs-component experiment exposed that Node tests cannot import `.jsx`
  directly. The controller now accepts an optional view adapter; production
  mounts the Solid Docs pane from the Vite entry, while tests continue exercising
  the original DOM adapter.
- After integrating the Docs pane via the optional view adapter: `npm test` passed
  (121 tests); `npm run build` passed.
- `git diff --check` passed after the latest UI/documentation changes.
- Docs message-only state migration validation: `npm test` passed; `npm run build`
  passed; `git diff --check` passed.
- Docs outer-section ownership and visibility/toolbar selected-state migration
  follows the Change Review signal pattern; controller DOM transitions remain
  available by default for isolated Node tests.
- After migrating Workspace proposal edit fields to Solid signals: `npm test`
  passed (122 tests); `npm run build` passed; `git diff --check` passed.
- Wayland visual/native acceptance not run.
- Repository-tools open/closed visibility and the Tools button's `aria-expanded`
  now derive from Solid signal state. Owner availability, asynchronous loading,
  disabled/loading state, and command workflows remain controller-owned. UX
  behavior is unchanged.
- Quick Requests history page visibility and search input now derive from its
  Solid component; controller loading/filter/action callbacks remain unchanged.
- The full-history page assertions now target the Solid component and its mount
  root. After this update: `npm test` passed (122 tests); `npm run build` passed;
  `git diff --check` passed.
- Docs page visibility and selected-tab state are Solid-driven in production;
  controller DOM behavior remains available for isolated tests. After migrating
  the Docs outer section: `npm test` passed (122 tests); `npm run build` passed;
  `git diff --check` passed.
- The Directories outer section and its visibility now render through
  `app/src/directories-page.jsx`; controller navigation transitions update a
  Solid signal, keeping the form, status, archives, repository list, and Back
  action inside one visibility boundary. Existing child mount roots and
  workflows are preserved.
- The outer workbench wrapper now renders through `app/src/workbench-shell.jsx`;
  its visibility is driven by a Solid signal updated by the controller for
  empty selection, Workspace selection, and Quick Request ownership. Toolbar,
  session-tab, and repository-tool roots and their existing button contracts
  remain stable. The workbench UX spec describes no behavior/layout change.
- The no-selection wrapper and its Workspace prompt now render through
  `app/src/no-selection.jsx`. The controller drives visibility and workspace-
  selection signals while retaining selection decisions and transitions. The
  no-selection UX specification describes no behavior change.
- Change Review toolbar availability and selected styling now derive from
  `WorkbenchShell` signals. The controller still calculates availability from
  workspace selection, verified repository count, and Quick Request ownership;
  it also retains Review loading/disabled state and all navigation/loading
  routing. IDs, classes, and native button semantics are unchanged. The relevant
  Workbench and Change Review UX specifications require no behavior change.
- Docs toolbar disabled presentation now derives from the `docsDisabled` Solid
  signal in `WorkbenchShell`. The Docs controller retains availability decisions,
  loading/cache/retry behavior, and selection; it reports disabled-state changes
  through an optional view callback. Its default DOM adapter remains for Node
  tests. IDs and selection behavior are unchanged, so the Docs and Workbench UX
  specifications require no update.
- Tools toolbar disabled presentation now derives from a Solid signal passed to
  the repository-tools component. The controller retains async loading and the
  existing timing of disabling/enabling; button ID, availability, expanded
  state, and open/close behavior are unchanged.
- After moving Docs and Tools toolbar disabled presentation to Solid:
  `npm test` passed (125 tests); `npm run build` passed;
  `git diff --check` passed.
- New-work proposal sizing class and dialog accessible name now derive from the
  Solid view/proposal signals. Capture mode retains the exact “New Workspace” /
  “New Quick Request” labels; review uses the existing proposal title. The
  controller still owns showModal/close and all callbacks. No UX behavior or
  accessibility change is intended.
- After migrating New-work proposal dialog styling/name: `npm test` passed
  (126 tests); `npm run build` passed; `git diff --check` passed.
- Quick Request terminal actions, including Back to Quick Requests, now derive
  visibility from a Solid signal. Destination transitions update that signal;
  the Back navigation callback remains controller-owned.
- After migrating Quick Request terminal-action visibility: `npm test` passed
  (126 tests); `npm run build` passed; `git diff --check` passed. A selector
  contract now checks the signal-backed component boundary.
- Successful starting-prompt submission now hides its Solid-owned section via
  `setPendingPromptVisible(false)` rather than a direct DOM visibility write.
  Repository search found no other production writes to that section's
  visibility; its rendering remains signal-driven. Existing tests cover the
  component boundary, so no additional contract test was needed.
- Change Review availability now clears Docs selection through the existing
  `setDocsButtonSelected(false)` signal setter. An architecture assertion guards
  against direct Docs toolbar selected-class writes; Docs controller behavior
  and selection transitions are unchanged.
- New-work setup-progress visibility now derives from a Solid signal, initialized
  hidden; the controller retains existing panel reparenting and progress-row/event
  handling.
- After migrating New-work progress visibility: `npm test`, `npm run build`, and
  `git diff --check` passed (127 tests).
- Session selection presentation cleanup: removed the remaining imperative tab
  selected-class, `aria-selected`, and `tabindex` loops from `showSession` and
  its tab selection callback. Both paths update `selectedSessionByOwner` and
  rely on `syncOwnerSessions` to refresh Solid tab records. Terminal-surface
  visibility and exact session/runtime selection are unchanged. Validation:
  `npm test` passed (127 tests), `npm run build` passed, and `git diff --check`
  passed. No additional behavior contract test was needed; existing session
  selection and accessibility contracts cover the behavior.
- Docs toolbar selected styling now binds directly to the existing
  `docsButtonSelected` signal in `WorkbenchShell` via Solid `classList`; the
  imperative `createEffect` DOM query/toggle is removed. The Docs controller's
  optional view callback and all selection/navigation transitions are unchanged.
  Architecture coverage guards the signal-backed binding. Validation: `npm test`,
  `npm run build`, and `git diff --check` passed.
- The static Directories navigation button now renders from
  `directories-navigation-button.jsx` at the same navigation position and binds
  click through `onOpen`. The controller retains page opening, error handling,
  and destination state; button semantics and accessible name are unchanged.
  Selector/architecture tests now recognize the Solid-owned button.
- The static “All” Quick Requests history button, including its SVG and accessible
  labels, now renders through `quick-request-history-button.jsx` at the existing
  heading position. The controller retains `showQuickRequestList()` and its error
  handling; the mount root uses `display: contents` to preserve the heading's
  flex layout. Selector/architecture tests cover the component contract.
- Docs toolbar clicks now bind through `WorkbenchShell`'s Solid `onClick` prop to
  the existing controller `open()` workflow. `createDocsController` retains its
  DOM-button click adapter by default for isolated Node tests; production disables
  that adapter. Controller view callbacks and loading/cache/selection behavior
  are unchanged.
- Change Review toolbar clicks now bind through `WorkbenchShell`'s Solid
  `onClick` prop to the named `handleChangeReviewClick` controller callback.
  Availability guarding, Docs/terminal transitions, disabled state, signal
  updates, loading/error handling, and owner identity checks remain in that
  callback; no workflow or command loading moved into JSX. Validation: `npm
  test`, `npm run build`, and `git diff --check` passed.
- Change Review toolbar disabled presentation now derives from a Solid signal in
  `WorkbenchShell`; the click workflow updates it through setter calls, preserving
  the prior loading interval and controller-owned loading/navigation logic.
  Availability, selected styling, IDs, and callback remain unchanged.
  Validation passed: `npm test` (128 tests), `npm run build`, and
  `git diff --check`.
- Workspace Complete/Reactivate disabled presentation now derives from owner-panel
  signals updated on Workspace and Quick Request selection. Active/completed
  availability, hidden behavior, callback guards, IDs, and classes are unchanged.
  Validation: `npm test`, `npm run build`, and `git diff --check` passed.
- Workspace attach-repository and session-submit disabled state now derives from
  owner-panel Solid props/signals. The existing active-Workspace and model-ready
  conditions are retained, with submission busy/finally state included; Quick
  Request visibility and controls are unchanged. Architecture coverage checks
  signal bindings and guards direct disabled writes.
- New-work proposal-create disabled presentation now derives from a Solid signal
  in `NewWorkDialog`. The controller retains readiness guards, Quick Request
  directory-resolution updates, setup busy/recovery handling, and the existing
  owner-created conditions and timing. Validation: `npm test`, `npm run build`,
  and `git diff --check` passed.
- New-work capture Continue disabled/busy presentation now derives from a
  `NewWorkDialog` prop backed by a Solid signal. `handleNewWorkCapture` retains
  validation and controls the signal at submit start and in `finally`, preserving
  the prior async workflow and busy timing.
- New-work proposal model-selector disabled state now derives from a Solid
  signal in `NewWorkDialog`, initially disabled and enabled on selector
  readiness. Option cloning/population, selected model value, loader command,
  and loader failure behavior are unchanged.
- New-work proposal model options and selected value now flow through Solid
  signals populated from the ready Quick Request selector's value/label pairs.
  The proposal select renders those records with `For`; serialized values,
  provider/model labels, default selection, readiness, and command usage remain
  unchanged. The shared loader and Quick Request selector are untouched.
- Workspace creation recovery now accepts an optional view adapter. Production
  updates the New-work pane, proposal error, and retry action label through Solid
  signals; the helper's default DOM adapter remains for direct Node tests. Exact
  recovery messages, retry labels, dialog accessibility/sizing, and workflow are
  unchanged.
- Shared `#quick-model` options, exact `{providerId,id}` JSON selection, busy/
  disabled/error presentation, and Quick Request submit gating now render from
  Solid-owned owner-panel signals. The existing model command adapters remain
  authoritative; Workspace session creation and Quick Request submission still
  read the same serialized selection. `initializeModelSelector` retains its DOM
  path for integration tests and accepts an optional production view adapter.
- The inline Quick Request submission error now renders from a Solid signal in
  `WorkspaceOwnerPanel`; production submission clears/sets that signal through
  an optional view setter. The handler's existing DOM `errorMessage` adapter is
  retained for integration tests. Submission timing, prompt retention, and model
  errors are unchanged.
- Remaining production Quick Request alert writes (history-open, initial request
  and navigation refresh, unavailable configured default, and model-load failure)
  now update `quickRequestError`. Their exact messages and timing are unchanged;
  submission adapter behavior remains unchanged. `main.js` has no stale
  `errorMessage` references.
- Quick Request model disabled/busy and submit-disabled attributes are now solely
  rendered from `WorkspaceOwnerPanel` Solid props/signals. `setModelControls`
  still updates `modelsReady` and calls `syncWorkspaceActionDisabled()` for
  Workspace session actions, but no longer duplicates those attribute writes.
  Architecture coverage guards the component bindings and absence of direct
  controller writes.

- `initializeModelSelector` now supports a view-only production path: when a view
  adapter is supplied without a DOM select, the loader reports loading, ready
  (including configured-default availability), and error states without touching
  selector DOM. The legacy DOM adapter remains for focused integration tests.
  Production Workspace and Quick Request submission read the Solid selected-model
  signal; command contracts, unavailable-default warnings, and error handling are
  preserved.

- Repository-tools handoff and install status text, handoff disabled state, and
  install button hidden/disabled state now belong to Solid signals in
  `RepositoryToolsMenu`/`InstallControl`. `main.js` retains command/session
  orchestration and sets presentation through callback setters. Initial text and
  button states, duplicate-install feedback, progress/results/errors, status
  roles, action IDs/labels/classes, and focus behavior are preserved. Adapter
  architecture coverage guards against direct DOM status/state writes.
  Validation: `npm test`, `npm run build`, and `git diff --check` passed.
- Directories repository-checkbox pending state and checked state now flow through
  `RepositoryDirectories` props/signals. The toggle callback receives the
  repository ID and requested checked value, updates that repository optimistically,
  restores its previous checked value on failure, and preserves save, refresh,
  catalog, and error ordering. The Rust command adapter is unchanged. Architecture
  coverage guards against DOM checkbox state writes.
- Directories add-folder disabled/busy presentation now derives from a Solid
  signal consumed by `DirectoriesLibraryForm`. The controller preserves the
  existing picker/scanning interval and cancellation, error, and success behavior;
  directory operations and controller workflow are unchanged. Architecture
  coverage guards against direct button disabled writes.
  Validation passed: `npm test` (142 tests), `npm run build`, and
  `git diff --check`.
- The Workspace attach-repository option records and selected ID now flow through
  Solid signals in `WorkspaceOwnerPanel`. Catalog loading remains controller-owned;
  refresh retains the selection only when its ID is still available, while attach
  consumes that signal. Labels, placeholder, active Workspace rules, and attach
  command/status/error workflow are unchanged. Validation passed: `npm test`,
  `npm run build`, and `git diff --check`.
- Terminal runtime import/start failure now sets a Solid signal consumed only by
  Quick Request and Workspace session submit-button disabled expressions. Existing
  model readiness/error and Workspace readiness/busy conditions remain combined;
  terminal status/error reporting is unchanged. Architecture coverage verifies
  the signal bindings and guards against the prior broad button-query mutation.
- Legacy archive Restore record disabled/busy presentation now derives from
  per-task Solid state in `LegacyArchivesList`. The controller callback accepts
  only the archive record; failures clear that record's busy state for retry,
  while success refreshes the archive list and preserves status text and the
  existing file/history guarantees. Architecture coverage guards against DOM
  button mutation. The retained Directories archive UX specification requires
  no behavior change.
