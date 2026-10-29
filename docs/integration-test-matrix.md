# Production integration-test matrix

This inventory follows the user-visible flows in `application-workflows.md`.
“Deterministic” tests use the production Rust store/runtime or the production
JavaScript adapter with a fake external boundary; they are not claims of live
provider or GUI acceptance. The Node installed-CLI model-loader test and Rust
`opencode_cli_contract` suite are explicit live-boundary exceptions: they start
the installed OpenCode child without sending a model prompt. The fixture parser
regression retains the historical `opencode v2.0.27` output; it does not pin the
installed executable's patch version.

| Vertical flow / trigger | JS boundary adapter | Tauri command | Rust service/runtime | External boundary | Success assertion | Failure assertion | Required level | Current test / gap |
|---|---|---|---|---|---|---|---|---|
| Workspace-name heading | selected owner title signal → WorkbenchShell → shared Heading | unchanged | unchanged; presentation only | Solid DOM + Chromium/Vite mock | full Workspace name appears above tabs, updates after another Workspace is created/selected, remains during Docs and Change Review, and hides with the shell for other destinations; terminal nodes remain mounted | composition regression failed before implementation with missing workbench heading | application composition + browser smoke; manual Wayland | `test/application-composition.test.js` extends the existing navigation/creation scenario; focused composition/workbench run passed 5 tests. Chromium confirmed one visible Workspace heading, no horizontal overflow, terminal reaching viewport bottom, and heading retained in Change Review. Production build passed. Full default suite reported 226 passed and 27 source-text assertion failures, matching the already documented failure count. Native Wayland rendering/IPC and real PTY acceptance were not run. |
| Workspace options | WorkspaceOwnerPanel → shared Collapsible | none | presentation only | Solid DOM; native separately | initially collapsed options use the shared SVG trigger and open on activation | existing option controls remain available | `test/work-area-controls.test.js`; native Wayland appearance remains manual. |
| Shared file navigator width | Docs and Change Review → shared divider → presentation preferences | `presentation_preferences_get`, `presentation_preferences_set_navigator_width` | Rust validates and persists shared width in SQLite | Solid DOM, browser fixture, file-backed SQLite; native separately | pointer and keyboard resize; both tabs share width; database reopen restores width | invalid widths rejected without mutation; late startup load does not overwrite a user resize | DOM, browser and Rust store tests; manual Wayland | `test/work-area-controls.test.js`, `test/presentation-preferences.test.js`, `tests/presentation_preferences.rs`; native IPC and Wayland drag/appearance remain unvalidated. Scroll and folder positions are not persisted. |
| Change Review layout preference | Unified/split controls → presentation preferences | `presentation_preferences_get`, `presentation_preferences_set_change_review_mode` | Rust validates and persists mode in SQLite | Solid composition, frontend command contract, file-backed SQLite | selected mode survives leaving and reopening Change Review and database reopen; existing width retained | invalid mode rejected; late preference load does not overwrite selection; preference writes are serialized | frontend composition and command tests, Rust store test; native separately | `test/application-composition.test.js`, `test/presentation-preferences.test.js`, `tests/presentation_preferences.rs`; native IPC and Wayland acceptance remain unvalidated. |
| Reader layout | Docs and Change Review rendered content → browser layout | none | presentation only | Vite mock and Chromium; native separately | long lines wrap, gutters follow scroll and navigator resize, split rows stay aligned, Markdown tables with five columns share width | long unbroken content and asymmetric split rows | `test/reader-layout.browser.test.js`; native Wayland appearance and interactive resizing remain manual. |
| Navigation SVG controls | DirectoriesNavigationButton → Button/Icon; NewWorkMenu → ActionMenu/Icon | unchanged directory and New-work commands | unchanged | happy-dom + Chromium/Vite; native separately | visible labels and decorative SVGs; Directories action and both New-work choices preserved; rendered icons remain 16px; SVG chevron follows disclosure state | regressions failed before the fix because both controls lacked SVGs; native marker suppressed in browser | component DOM regression + browser rendering/state check; manual Wayland | `test/navigation-dom.test.js`, `test/icon-button-layout.browser.test.js`, existing menu/modal/composition suites pass. Native WebKitGTK marker suppression, focus and rendering remain manual. |
| ActionMenu direction and chevron motion | NewWorkMenu → shared ActionMenu `direction="up"`; other menus default down | none | none; presentation only | Chromium/Vite component fixture and actual app; happy-dom semantics | native down and controlled up menus place correctly; New work opens upward with up-closed/down-open chevron; rotation animates both ways; reduced motion preserves state without animation | browser regression failed before implementation on absent rotation transition | browser rendering/motion + existing menu/navigation/overlay DOM tests; manual Wayland | `test/ui-control-fonts.browser.test.js` extends the shared fixture with a standalone controlled upward menu; `test/icon-button-layout.browser.test.js` waits for rotation completion. All 14 browser checks passed; focused DOM run passed 23 checks with one unrelated composition failure at the tool-tab Close selector. Production build passed; native acceptance remains manual. |
| Whole-CSS-pixel UI spacing | `@ui-lib` theme tokens consumed by primitives, app components and screen/shell CSS | none | none; presentation only | Chromium + real Vite fixture; native Wayland separately | Button/menu padding remains 6px/12px, fields 6px/8px, AppNotice 10px/12px at 16px and 20px root fonts; existing modal/Quick Request browser checks remain green | browser regression fails on original fractional control padding | browser computed-style regression + existing composition/DOM suites; manual native visual acceptance | `test/ui-control-fonts.browser.test.js` extends the existing fixture; passed after failing before the fix. Native Wayland appearance, focus, overlays and terminal rendering remain unvalidated. |
| Tools menu presentation and sections | RepositoryToolsMenu → shared ActionMenu, ActionMenuItem, ActionMenuGroup, ActionMenuSeparator; New work uses the same surface and rows | unchanged | unchanged; presentation only | Solid DOM + Chromium/Vite production component fixture and actual app | flat native-button rows; named heading groups; non-focusable dividers; Open in above scripts; cyan headings and lavender subheadings with indented contents | disabled rows cannot act or close; hidden items remain hidden; row activation never submits an enclosing form | shared component semantics + existing application/menu interactions and browser layout; visual review; manual Wayland | `test/action-menu-dom.test.js` covers primitive semantics, forwarding, focus and native behavior. Focused component/controller run passed 32 checks, composition/workbench/menu run passed eight, all 15 browser checks and build passed. Wide/narrow screenshots inspected; Tab/Escape exercised; menu axe audit had zero violations/incomplete checks. Native appearance remains manual. |
| New Work modal sizing and standard interactions | NewWorkDialog → shared Modal; existing cancellation controller | unchanged proposal/create commands | existing cleanup/process ownership unchanged | Chromium + real Vite mock entry; native WebKitGTK separately | content-fitting capture/review, fixed header/footer, bounded scrolling, native form validation, keyboard focus/return | backdrop cannot discard work; cleanup rejection remains caller-owned | browser regression + DOM/controller + composition; manual Wayland | `test/modal-ux.browser.test.js`, `test/ui-dom.test.js`, `test/new-work-dialog-controller.test.js`, `test/application-composition.test.js`; browser regressions passed after failing before the fix. Native IPC, rendering, provider and PTY acceptance remain open. |
| Browser fixture and local modes | Actual Vite entry, command boundary and in-memory fixture | no IPC in development browser; native builds use Tauri | none in fixture | Chromium, Vite; native Tauri separately | Shell, Workspace create/open, simulated terminal, Directories, Docs, Change Review, Tools, Quick Request creation/list/open/delete | unsupported actions fail closed; command failures report bounded metadata without payload | Browser inspection + fixture/mode tests; native separate | `test/browser-fixture.test.js`, `test/local-mode.test.js`, `test/quick-request-history-controller.test.js`; agent-browser exercised Workspace and Quick Request creation, Quick Request list/reopen/delete and tool terminal, and confirmed blocked OS handoff/diagnostics. Native `live` and direct `tauri dev` are intentionally live. Mode selection is unit-tested without launching a native backend. Real native IPC, actual processes and provider behavior remain separate acceptance. |
| Quick Request custom directory | New-work capture → creation controller → command adapter → Rust store | `quick_request_create` | Existing canonical directory, persisted session directory | Tauri, OpenCode and native folder picker | Typed or chosen directory overrides a proposal for one request; default remains unchanged | Invalid or missing custom directory rejected before creating a session | Rust store regression and frontend command/controller checks | Native picker, full IPC/session creation, and reopening a custom-directory terminal remain manual acceptance. |
| Shared UI library adoption | `@ui-lib` → `packages/ui-lib/` primitives composed by New-work, navigation, Directories, Quick Requests, workbench, Docs and Change Review | none | existing dialog controller, session and process ownership (unchanged) | Vite client bundle, happy-dom; native Wayland dialog | DOM tests cover menu dismissal and Escape focus, explicit overlay close, accessible-name warnings, tabs, New-work controls, navigation and workbench | controller tests cover asynchronous cleanup failure; backdrop clicks do not dismiss dialogs; overlay close requests remain caller-owned | component DOM + controller tests; manual Wayland | `test/ui-dom.test.js`, `test/overlay-interaction.test.js`, `test/workbench-ui-dom.test.js`, and `test/new-work-dialog-controller.test.js` exercise component and controller behavior; native dialog methods are stubbed. `frontend-organization.test.js` checks package/alias boundaries; test bundles reuse production Vite aliases. Actual styling, animation, focus, native dialog/picker, provider, terminal and window lifecycle remain manual. |
| Default terminal WebGL renderer with DOM fallback | Shared `TerminalRuntime` attempts `@xterm/addon-webgl` after `terminal.open` for every attachment; no setting gate | existing terminal commands unchanged | existing exact-session PTY ownership | xterm WebGL addon, Chromium 153 browser fixture; native Wayland/WebKitGTK still manual | both OpenCode attachment paths attempt WebGL by default; the actual fixture activated a WebGL2 canvas, and after forced context loss xterm stayed mounted with rendered output on its built-in DOM renderer | constructor/load failure or context loss returns to xterm's built-in DOM renderer without blocking attach/replay/input/resize; addon resources release on teardown | runtime lifecycle tests + actual browser smoke + manual Wayland comparison | `test/terminal-runtime.test.js` covers default activation in both paths, initialization fallback, context-loss fallback and teardown with controlled addon doubles. Browser smoke exercised an actual WebGL2 context and forced `WEBGL_lose_context`; it does not establish native WebKitGTK availability or a performance benefit. Manual Wayland comparison remains open; see `terminal-rendering-research.md`. |
| Installed OpenCode CLI/server contract (explicit non-GUI gate) | Node model-loader harness; Rust-only contract suite separately | `opencode_models` service adapter (not native IPC) | production executable resolution/help validation; authenticated runtime info/model/catalog; server `Drop` | installed OpenCode v2.0.28 child; immutable CLI-output fixtures | installed help advertises `--server`/`--session`; server/CLI versions agree; catalog satisfies production shape/filter; direct server child reaped | malformed/unsupported version or missing flags rejected; malformed model wrapper remains an error | explicit installed-CLI integration, no provider prompt or TUI | Item 7 pre-selection-fix baseline: `cargo test --manifest-path app/src-tauri/Cargo.toml --test opencode_cli_contract -- --nocapture` passed 7/7, no ignores/extra feature flags; full Rust also passed. Post-fix `npm test --prefix app` reran the Node model-loader checks, not the separate Rust CLI suite. Does not validate native IPC, actual interactive TUI readiness/render/input, provider flows, coordinator plugin execution or descendant cleanup |
| Initial shell bootstrap (normal launch, no selection) | `loadApplicationShell` → production `createApplicationShellView` signals → `ApplicationShellStatus` | `app_shell_info` (no payload) | startup management-storage status and version DTO | Tauri IPC; Solid view; Wayland | ready response sets connected message/version/result; later terminal-close result feedback preserves connection state | storage-error response stays distinct from disconnected transport failure, with exact result/error feedback | nonvisual production signal-adapter execution + command inventory; manual native launch/rendering | `test/shell.test.js` executes the actual production view for success/storage error/rejection; `command-contract.test.js` checks presentation/command ownership. Entry imports, eager bindings, parent-before-child mounts, and launch order reviewed in source. No automated DOM rendering added; actual Tauri initialization/navigation/model loading still require manual Wayland launch |
| Workbench shell sizing, session tab list, and bottom-pinned New work | shell mount points expose Workbench/content/owner/destination children to their flex parents; tablist receives direct tab-item wrappers and owns keyboard events; navigation menu mount preserves its auto-margin placement | none | none | Chromium/Vite fixture at 720x560 and 1000x720; native Wayland remains the acceptance target | right pane and owner reach viewport bottom, terminal stays within window, tab items share a row, New work sits at navigation bottom, and document overflow is absent | regression if mount wrappers consume flex height, tabs stack, terminal extends below viewport, or New work floats above navigation bottom | authorized Chromium visual/layout verification + manual Wayland | Seeded three-tab/terminal fixture passed both Chromium sizes; measurements and screenshots are recorded in `solidjs-refactor-progress.md`. No Chromium result is native Tauri/Wayland evidence; Quick Request destination/workflow remains unchanged |
| Workspace navigation busy presentation | `createWorkspaceNavigationController` → `navigationBusy` signal → `WorkspaceNavigation`-owned `#workspace-list` | `workspace_navigation` | existing navigation DTO | Tauri IPC, Solid view, Wayland | list starts busy; existing navigation publication clears busy through a setter, not a DOM mutation | failed initial load retains existing busy/error behavior | nonvisual controller + architecture contract; manual Wayland | `test/workspace-navigation-controller.test.js` covers navigation-complete reset with Workspace/no selection/Quick Request; `command-contract.test.js` checks list/signal ownership. Actual navigation/busy rendering and native loading remain manual; no new DOM rendering automation |
| Workspace tab strip, owner selection, restore, and close fallback | shared `TabList`/`Tab` → WorkbenchShell/SessionTabList; `ownerSessionTabState`, `restoreOwnerSessionTabs`, existing session/close adapters | existing restore and cleanup commands (unchanged) | persisted exact owner/session/directory; Rust remains process owner | Solid DOM, Tauri IPC, OpenCode, PTY, Wayland | one controlled selection across sessions, terminals, Docs and Change Review; arrows/Home/End skip hidden/disabled tabs; each closeable tab has an independent ×, readers have none; close does not select a tab; ARIA ownership excludes close buttons; Docs preserves terminal node identity and attachment count | unavailable/removed selection retains an enabled keyboard entry; focused-close removal recovers tab focus without stealing outside focus; actions and composing/prevented keys cannot navigate; foreign owner tabs stay excluded; restore/close errors retain existing feedback | component-workspace DOM + application composition + owner-state/controller tests; browser smoke; manual Wayland | `packages/ui-lib/test/tabList.test.js` owns close-button, focus, accessible-name, and dynamic ARIA-ownership behavior. Application tests cover only screen/controller wiring and terminal preservation/cleanup, not tab internals. `test/terminal-runtime.test.js` covers selecting without terminal autofocus; `test/session-tab-state.test.js` covers owner fallback/restore. Browser axe and accessibility-tree checks validate tab/close separation. Native IPC, real terminal input/replay/process cleanup, screen-reader behavior, and Wayland appearance/focus remain manual. |
| New-work progress across capture/review/recovery | `newWorkProgressDestination` → dialog-composed `SetupProgressPanel`; shared row signals and existing streamed-event/recovery adapters | existing proposal/create commands and `workspace-setup-progress` event | existing setup progress/status production | OpenCode, Git, Tauri events, Solid view, Wayland | one active destination: after Original prompt in capture, Workspace starting prompt in review, or Quick Request directory review; rows remain outside pane lifetime | Back/recapture uses capture despite retained proposal; closed view has no progress panel; durable-owner recovery reopens review with shared failure rows | nonvisual presentation-data/architecture checks + existing controller coverage; manual Wayland/provider | `test/new-work-progress.test.js` covers destination data through capture/review/close/recovery; `command-contract.test.js` checks composition/shared-row ownership and absence of reparenting/child root. Existing proposal/creation controller and progress-data tests cover callback/status/error rules. Manual pending: actual placement/one visible list, streamed rows/details and setup/session retry after owner selection, Back/cancel/reopen, footer/scroll behavior, and attached-terminal identity/input preservation; no DOM/layout test added |
| Quick Request discovery and opening | Recent and full-list destinations; dedicated page with terminal filling available height; persistent navigation to list | `quick_request_list`, `quick_request_restore`, terminal restore/attach | 24-hour creation-time filter; full retained list; exact session association | SQLite, PTY, Wayland | recent list filters by age; full list keeps retained requests; opening shows no tabs/task controls; navigation preserves process | failed restore reports an error without selecting an unrelated session or losing the destination | Rust store + frontend contract/DOM + manual Wayland gate | `test/application-composition.test.js` exercises navigation back to the list while retaining terminal nodes. Rust cutoff/history test and frontend selector/flow assertions; Wayland visual/process-lifecycle acceptance remains manual. |
| Quick Request recent-list selection | Production `createQuickRequestSelection` signal shared by owner/controller getters and persistent recent/full-list ID accessors | existing restore/delete commands (unchanged); Workspace clear is presentation state | existing owner/session association; no new durable state | Solid client reactive core, controller command/session seams; Wayland | initial no selection; open/switch invalidates unchanged-record observers; Workspace selection clears; selected deletion clears; list navigation and nonselected deletion retain owner | cancelled/rejected deletion and rejected restore retain selection | nonvisual production signal/controller tests; manual native highlight/terminal acceptance | `test/quick-request-selection.test.js` runs once-subscribed computations with the client Solid condition in Node (no DOM); `test/quick-request-history-controller.test.js` uses the production signal, including selection before exact-session display. Main's three owner-selection/clear writes and all readers reviewed in source. No shallow-clone refresh, list remount, DOM/render/layout or terminal automation added. Post-fix Wayland highlight/open/switch/Workspace-clear/delete and stable-terminal acceptance remain pending |
| Model loading (startup selector) | `initializeModelSelector` → `getDefaultModel`, `listAvailableModels`; `modelSelectorChoices` supplies production JSX option data | `opencode_model_default`, `opencode_models` | persisted setting lookup; `opencode_models_command` → `Runtime::enabled_models` | `model-loader-harness` starts real installed CLI/server; authenticated `/api/info` + `/api/model`; wire harness reads the migrated SQLite model setting | live Rust catalog crosses the production command contract and choice-data adapter; persisted default selects the exact serialized model when present | CLI/API failure or empty catalog invokes error callbacks without ready data; unavailable default is not synthesized and selects first live choice with a warning callback | **cross-language nonvisual integration** (Rust harness + Node child process + production loader/choice adapter); no DOM selector population remains | `test/model-loader-integration.test.js` retains real installed-CLI and wire harness checks; deterministic cases cover errors and available/unavailable defaults. `test/rust-wire-contract.integration.test.js` and explicit `tests/opencode_cli_contract.rs` remain separate. Actual reactive disabled/empty/error presentation, selector events, Tauri WebView and provider availability remain manual/live gaps |
| Quick Request create/start and submit UI state | New work dropdown → directory proposal/confirmation → `submitResolvedQuickRequestFlow` | `new_work_proposal_run`, `quick_request_resolve_directory`, `quick_request_create`, `quick_request_start_prompt` | registered-repository validation → atomic task/session/original-prompt persistence → attach exact session and send prompt loaded from storage | OpenCode, SQLite, PTY, filesystem | original prompt is stored only in `quick_request_prompts` and sent unchanged after the dedicated terminal page is mounted | invalid directory or proposal creates no request; startup failures leave a recoverable stored request; strict result/payload contracts hold | Rust integration + DOM/JS contract/state + manual provider/Wayland | management prompt/directory/migration tests; `tests/production_vertical_flows.rs`; `test/shell.test.js`; `test/rust-wire-contract.integration.test.js`; native WebView/provider acceptance remains manual |
| Retained hidden Quick Request form compatibility | `WorkspaceOwnerPanel` → `createQuickRequestSubmitHandler` with production `createQuickRequestFormView` → `submitQuickRequestFlow` | `quick_request_create`, `quick_request_start_prompt` (unchanged) | existing validated create/start contracts; Rust still owns persistence/processes | Solid signals, Tauri IPC, OpenCode, PTY, native form validation | exact original whitespace and parsed model snapshot; readiness then terminal gate; show exact session before send; clear via signal only after acceptance and before refresh; return record; busy spans all awaits | not-ready no-op; cancelled terminal gate emits no command; malformed model/create/display/deferred-send errors retain text and release busy; refresh error follows accepted-prompt clear | nonvisual production signal/handler/flow/command tests + architecture contract; legacy DOM binding compatibility only; manual native/Wayland | `test/quick-request-form.test.js` runs the actual signal view and command adapter with deferred success/failure/gate cancellation; `shell.test.js` covers setter-based flow and records; `command-contract.test.js` guards hidden/native JSX wiring and no production prompt/button DOM lookup. `quick-request-form.integration.test.js` is explicitly legacy DOM fallback/event binding, not Solid rendering acceptance. Actual required-field/native Enter validation, reactive rendering/readiness, IPC, provider and terminal lifecycle remain manual; no GUI/render automation added |
| Quick Request restore/follow-up | `restoreQuickRequest`, terminal input adapters | `quick_request_restore`, terminal write | exact stored ID/directory restore, no initial prompt | SQLite, OpenCode history, PTY | history/terminal reconnects to stored session; follow-up stays same session | mismatched context or missing session fails without newest-session guess | Rust integration + JS state + manual TUI | management/session tests; manual/live TUI still required |
| Global pending-input refresh | Startup and periodic `refreshGlobalPendingInputs` | `opencode_pending_inputs_all` | current tracked-session enumeration and pending-input API calls | SQLite, OpenCode API, frontend notice | missing/retired IDs do not block pending inputs from current sessions; successful refresh clears only its matching stale notice | active-session API errors remain visible; unrelated notices remain unchanged | Rust orchestration + JS DOM behavior | `global_pending_input_collection_ignores_retired_session_ids`; `error-events.test.js`; manual live startup remains part of Wayland acceptance |
| Workspace create/planning sessions | `createWorkspace`, `createWorkspaceSession` | `workspace_create`, `workspace_session_create`, `opencode_session_restore`, `workspace_navigation` | zero/one/multi-repository session routing; exact repo association; persisted `workspace`/`orchestrator`/`worker` role context; confirmed-missing session replacement in the same directory | SQLite, filesystem, OpenCode | zero repos: one home session labeled Workspace; one repo: one worker session; multiple repos: one orchestrator plus one empty worker per repo; terminal labels come from persisted role/repository associations; missing session is replaced with an empty conversation and old history is retained | only OpenCode HTTP 404 triggers replacement; generic failures remain visible; completed Task replacement is rejected; no prompt is sent | Rust migration/store + frontend label/command contract + manual Wayland/provider | `migration_18_records_workspace_sessions_worktrees_and_non_lifecycle_tags`, `Workspace session tabs label sessions from persisted role and repository context`, and `rust-wire-contract.integration.test.js` validate role context; production confirmation/session orchestration and live Wayland/OpenCode behavior remain unverified |
| Repository directory tree, catalog, bulk soft-delete, and library setting | Top-navigation **Repositories** → Docs-style tree → native multi-folder picker; row delete icon starts multi-select; configure managed repository-library root | `repository_scan`, `repository_catalog`, `repository_directory_page`, `repository_enabled_set`, `repository_soft_delete_many`, `repository_library_get`, `repository_library_set` | canonical scan roots, project-home and configurable-library exclusion, linked-worktree filtering, identity de-duplication, persistent enabled state, atomic soft-delete, scan suppression by retained Git identity | Native dialog, real Git, filesystem, SQLite, Solid DOM, OpenCode proposal | saved roots are scanned on startup; overlapping roots display each verified repo once; roots sharing a filesystem-level component group at their shortest common parent when combined count is at most five; larger groups and lone roots retain scan-root paths; child folders with at most five repositories collapse independently into their parent; confirmed bulk deletion hides catalog entries while preserving files and workspace bindings | groups over five remain separate; child folders over five remain visible; paths inside OpenCode Projects or repository library are rejected; scans do not rediscover soft-deleted identities; failed bulk deletion changes no rows; cancel makes no command; disabled repos cannot be selected; invalid library paths do not overwrite saved values | frontend DOM/command contract + Rust persistence, transaction, Git/path tests + manual Wayland picker/tree review | `test/repository-directory-tree.test.js`, `test/directories-page-dom.test.js`, `test/directories-controller.test.js`, `test/shell.test.js`; Rust soft-delete/reopen, binding-preservation, atomicity, and rescan tests; manual Wayland acceptance remains |
| Workspace repository provisioning | Confirm repositories and optional starting prompt in the reviewed Workspace proposal | proposal/confirm and repository binding commands | source identity and reviewed-commit revalidation; remote-grouped managed base checkout; Workspace-specific repo-rooted worktree and branch; verified local symlink alias; persisted base/worktree/alias paths; session-role directory contract; recursive submodules | Real Git and submodule fixtures, SQLite, filesystem, OpenCode proposal | dirty source changes stay untouched and are not copied; base is shared and never silently overwritten; retries reuse verified base/worktree/branch/alias and retain recorded paths after a library-root setting change; one repo opens one worker session; multiple repos open an outside-repo orchestrator plus one empty worker per repo; zero repos opens one Workspace-home session; blank starting prompt still starts all required sessions; nonblank prompt goes to the one-repo worker or multi-repo orchestrator only | changed source identity/commit/default branch/remote/submodule metadata or occupied managed checkout/worktree/alias fails without overwriting data; dirty source status alone does not fail; partial provisioning is retryable at the same paths; no LFS fetch; sessions use canonical worktree paths rather than symlink aliases; regular prompts are transient and never logged or persisted | Rust real-Git provisioning tests + management role/path tests + frontend command contract + manual Wayland/OpenCode acceptance | real-Git provisioning proves dirty source tracked/untracked changes are excluded while original data remains; base/worktree/alias retry-path tests pass; Tauri confirmation and multi-session process path still need production orchestration coverage and manual Wayland/OpenCode acceptance |
| Multi-repository coordination tool | Orchestrator invokes `workspace.send_to_repository_worker` with a repository ID and repo-specific prompt | Workspace-local OpenCode plugin generated by Rust from persisted worker associations | validates repository membership; queues only to the exact worker session ID; acknowledges admission without claiming completion; never returns or stores worker transcript | OpenCode v2 plugin API, SQLite-owned associations, generated Workspace metadata | call queues to the matching existing worker; unrelated/unknown repository and blank prompt are rejected; response acknowledges only admission | no prompt fan-out; no app transcript copy; user files and symlinks are never overwritten/followed | Rust generated-file safety + JS tool behavior + installed OpenCode integration + manual two-repository session | `workspace_coordinator::tests` and `test/workspace-coordinator.test.js` cover generated worker association files and exact queued routing; installed-OpenCode plugin loading/tool execution and production orchestration recovery remain unverified |
| Legacy Task setup compatibility | No regular Task creation/navigation; migration 19 retains versioned legacy Task snapshots and migration 20 repairs early v18 worktree schemas | No archive list/restore commands; legacy task commands remain compatibility-only | versioned snapshot contains Task metadata, bindings, session associations/directories, setup/cleanup state; no prompt/transcript content or filesystem mutation | Historical file-backed SQLite, filesystem fixture | migration retains archived metadata without restoring Task records; startup adds missing worktree path columns before Workspace provisioning queries use them | Quick Requests are excluded; archived paths and filesystem data remain untouched | Rust historical migration and frontend absence check | `management::tests::historical_task_rows_are_archived_before_conversion_without_touching_files` and `migration_20_repairs_shipped_v18_worktree_table_without_base_checkout_column`; native Wayland remains manual |
| Workspace completion/reactivation | Complete/reactivate the selected Workspace | `workspace_complete`, `workspace_reactivate` | Workspace lifecycle changes without depending on legacy Task lifecycle | SQLite/filesystem | Workspace completes/reactivates; sessions and files are retained | no Git/filesystem cleanup or data loss occurs | Rust store + frontend command contract + manual Wayland | management lifecycle test covers active retained legacy Task; GUI lifecycle remains manual |
| Change Review | Workbench **Change Review** for the selected Workspace; repository-grouped file tree and unified/split diff, with automatic full context | `change_review_load`, `change_review_full_diff` | verified Workspace checkout resolution; Git status and bounded single-file diff against supported remote/local base | Temporary real Git repositories, SQLite owner bindings, Solid view, browser fixture, Wayland | associated repositories and selectable files; full context includes unchanged lines | unsupported owners, foreign repositories, invalid paths and oversized inputs rejected; compact diff retained on failure; stale context response ignored | Rust real-Git + frontend contract and DOM + browser fixture; manual Wayland | `change_review::tests`, `tests/change_review_integration.rs`, `test/change-review-ui.test.js`, `test/change-review-controller.test.js`, `test/work-area-controls.test.js`. Native IPC, retained terminals and Wayland rendering remain manual. |
| Docs reader | Workbench **Docs** → `createDocsController` → production `createDocsView` → `DocsPane`; `createDocContentAdapter(document.defaultView)` | `docs_list`, `docs_read` | Workspace home and verified Workspace checkouts only | SQLite bindings, real filesystem, sanitizer Window, Solid view, Wayland | first source is selected; list cache, repository/home identity, selected content and destination signals are preserved; only sanitized parser output is exposed as Markdown HTML, text remains data | stale owner/selection reads and errors cannot publish; confirmed empty disables; list failure remains retryable; file failure clears prior content without losing list; Rust rejects restored Task owners and unassociated paths | Rust integration + nonvisual production view/controller/command and content-routing tests; manual rendering/security acceptance | `docs_reader::tests`, `tests/docs_reader_integration.rs`; `test/docs-ui.test.js` (commands), `test/docs-controller.test.js` (actual signal view), `test/doc-content.test.js` (parser/sanitizer doubles, not actual sanitization). Architecture contract checks Window wiring. Legacy DOM defaults/renderers/tests retired. Manual pending: Markdown/unsafe HTML and links, literal text, source groups/selection/messages, terminal return/identity and native IPC; no JSX/DOM/security-render automation added |
| Repository tools and OS handoff | Workbench **Tools** for the selected Workspace; stable live action forwarders → production controller; actions registered before group publication | `repo_tools_*`, `workbench_*` | Rust resolves verified Workspace paths/home only; no Task owner or UI-supplied filesystem path | Real Git/filesystem, SQLite, PTY, OS process, Solid view, Wayland | loaded run/install/handoff callbacks reach current actions; synchronous automatic install uses the loaded owner; reopen does not duplicate pending/started installation; existing busy/status feedback remains | stale owner responses/actions are rejected by type and ID; failed install startup releases its key for retry; restored legacy Task owners are rejected by Rust; process/path failures stay visible | Rust path/command tests + frontend contract/nonvisual production action/order tests + manual Wayland | `repo_tools::tests`, `os_handoff::tests`, `test/repository-tools-controller.test.js`, and frontend tool/terminal adapters; controller tests invoke installation synchronously at the group setter seam, not through DOM rendering. Native menu interaction, terminal identity/input, explicit-close/map cleanup, and actual OS launches remain manual |
| Quick Request delete | Full-list **Delete** action with confirmation (recent navigation has no Delete) | `quick_request_delete` | stop attached PTY; transactionally remove task, stored original prompt, and local session association; preserve OpenCode conversation | SQLite, PTY, OpenCode | selected deletion clears the shared selection signal; nonselected deletion retains selection; stored request is removed and attached terminal closes | cancel/rejected delete retain selection; runtime cleanup or store failure is reported without claiming deletion | Rust store + frontend command contract/nonvisual controller + manual Wayland | management delete test, command contract and production signal/history-controller checks; manual confirmation, rendered list refresh and process lifecycle remain part of Deliverable 2 gate |
| Quick Request full-list search | Search field on full Quick Requests destination | none (local view filter) | case-insensitive literal substring of original prompt; trim query edges; blank query shows all | DOM | matching rows only; clearing restores all rows; recent navigation unchanged | non-empty no-match query shows the specified empty state; records are not mutated | frontend DOM interaction test + manual Wayland | `quick-request-search.test.js`; Wayland visual acceptance required |
| Frontend page resource lifetime | `createApplicationLifetime` owns persistent Solid islands, app events, polling and `TerminalRuntime` | no teardown command; old page client rejects later commands | Rust retains PTY/process ownership and persisted history associations | Solid render disposers, Tauri unlisteners, timer, runtime adapter | startup once; terminal adapter release precedes reverse nested-root disposal; navigation/hiding retain resources | late app/runtime subscriptions unlisten; late import cannot construct runtime; partial listener failure releases handles; disposed callbacks/timers and runtime commands do not run | nonvisual production owner + real runtime with external boundary doubles; architecture inventory; manual native/Wayland/HMR | `test/application-lifetime.test.js`, `test/terminal-runtime.test.js`, `test/command-contract.test.js`; tests cover release ownership, pending races, idempotence, timer cancellation, retained hidden state and no Rust calls during/after teardown. No new DOM/terminal rendering, GUI or native lifecycle automation. Actual unload/HMR, terminal identity/input, window hide/tray and quit remain manual |
| Hide/reopen view and window | terminal runtime/session tabs; page owner is not a navigation or visibility scope | terminal attach/restore/detach | PTY ownership and buffering | Tauri window, PTY/TUI | hiding does not stop process or dispose page resources; replay on reopen | listener/attach failure disables affected action | JS state/resource ownership + manual Wayland | `test/terminal-runtime.test.js`, nonvisual `test/application-lifetime.test.js`; actual terminal/window/tray lifecycle remains a Wayland/manual gap |
| Startup recovery | startup event listeners; navigation adapters | startup is lifecycle, reconcile commands | SQLite reconciliation + runtime restore | SQLite, OpenCode API/events, PTY | uncertain sessions/jobs are reconciled without duplicate owner | recovery failure emits visible session-scoped error | Rust integration + JS event contract + manual restart | startup Rust tests/error-event tests; live restart gap |
| Full shutdown/tray quit | Tauri lifecycle (no direct adapter) | tray callback | `Runtime::shutdown` terminal/server child cleanup | child processes, PTY, tray/OS | all app-owned children are killed and waited | cleanup errors are surfaced/logged and commands are gated | Rust child-process + manual Wayland tray | runtime/terminal shutdown tests; tray/descendant manual gap |

## Coverage conclusion

### Shared menu presentation and heading hierarchy (28 October 2026)

The inconsistency came from New work explicitly requesting an accent surface,
Tools falling back to neutral, and both composing ordinary Button controls.
ActionMenu now defaults to the purple accent surface. Both menus compose shared
ActionMenuItem rows; Tools also composes ActionMenuGroup headings and semantic
ActionMenuSeparator dividers. Groups own stacked, indented contents, light-cyan
section headings and light-lavender nested headings. Install actions use the same
row primitive. Application CSS retains only placement, repository-column layout,
and workflow-status text. Native Tab/Enter/Space behavior remains; these are not
ARIA arrow-key menus.

Component tests cover semantics, disabled/hidden state, attribute forwarding,
focus, selection dismissal and avoiding accidental form submission, not CSS
parity between screens. Actual-app wide/narrow screenshots were inspected;
keyboard Tab reached the handoff rows and Escape returned focus to Tools. The
menu axe audit reported zero violations and zero incomplete checks. The focused
32-test component/controller run, eight-test composition/workbench/menu run,
15 browser checks and production build passed. The full default suite reported
229 passed and 27 failures in existing command-contract source assertions.
No Rust behavior or IPC changed. The library README and affected UX specs are
updated; the UX index structure is unchanged. Native Wayland rendering, real OS
handoff and process/provider acceptance remain manual.

### Tools menu section layout (28 October 2026)

The Open in section now occupies the full first row, with a horizontal divider
above the repository script groups. Its three buttons stack vertically at equal
widths; the existing layout regression also checks this at both viewport sizes
and failed on the previous horizontal button layout. The menu now sizes to its
contents with a 12rem minimum and a viewport cap instead of the forced 64rem/
work-area width. Repository groups use intrinsic widths and wrap as needed.
The browser regression failed on excessive width before this sizing change,
then passed with compact sizing, viewport containment, and side-by-side groups.
The existing browser fixture now renders the production Tools
menu with two repositories: its layout regression failed before the change and
passed afterward at 1280px and 720px widths. All 15 browser checks, three focused
menu interaction checks, and the production build passed. The workbench UX
specification and screen map describe the updated layout; no workflow, command,
or Rust behavior changed. Native Wayland appearance remains unvalidated.

### ActionMenu direction and chevron motion (28 October 2026)

ActionMenu now owns up/down placement, entry origin, and animated chevron
reversal. New work selects `direction="up"`; navigation CSS retains only its
menu-width layout, not directional positioning. Reduced motion disables popup
entry and chevron rotation. The library README and New work UX specification
document the contract; the UX index needs no update because no destinations or
interaction areas changed. No Rust behavior or IPC changed.

The regression failed before implementation and passed afterward. All 14 browser
checks and the production build passed. The default suite reported 223 passed
and 31 failed, in command-contract source assertions and tab-close/component
expectations outside this change. Native Wayland rendering and motion remain
unvalidated.

### Workspace tab strip (28 October 2026)

Per-tab close follow-up: every closeable session now has its own adjacent ×,
including inactive sessions; Docs and Change Review have none. Restart remains
selected-session-only. The visual group stays joined; `aria-owns` keeps the
logical tablist restricted to visible tabs in DOM order. Library-owned tests
cover independent close callbacks, close-disabled state, no implicit selection,
no nested buttons, dynamic ownership, and focused-close removal. Application
composition locates Close by accessible name and checks the real controller's
terminal cleanup rather than inspecting tab structure. Eight `ui-lib` tests and
five workbench/composition tests pass. The full suite ran 256 tests: 229 passed,
with the same 27 source-text failures in `test/command-contract.test.js`.
Build and diff checks pass. Chromium checks show one × per session, no reader
close buttons, preserved reader selection/focus after inactive close, and zero
workbench axe violations/incomplete checks. Wide/narrow screenshots were
inspected. Native Wayland and screen-reader acceptance remain unvalidated.

Joined-group follow-up: removed outer padding and inter-tab gaps, kept single
dividers, and limited rounding to the first visible tab's left end. Empty strip
space retains the solid darker background and requested inset shadow. Browser
checks assert touching tab edges, zero strip padding, and square later tabs;
wide/narrow screenshots were inspected. Component interactions are unchanged;
native Wayland acceptance remains manual.

Visual-alignment follow-up: tabs now reuse the same shared control styling as
Tools, rather than maintaining separate typography and corner radii. A browser
regression check against the actual Workspace toolbar failed before the fix
(`700 14px / 19.6px` versus Tools' `500 13.12px / 16.4px`) and passed afterward
for font, padding, corner radius, height, and row alignment. Wide and narrow
browser screenshots were inspected. The recessed strip remains; active tabs
use the shared primary background/text treatment instead of a border marker.
Six component tests, five workbench/composition tests, the Vite
build, and the workbench accessibility audit passed. This styling-only follow-up
does not change workflows or IPC; native Wayland appearance remains unvalidated.

Tab behavior tests now belong to the `ui-lib` workspace at
`app/packages/ui-lib/test/tabList.test.js`. Six component tests cover controlled
selection, accessible names, orientation, roving focus, hidden/disabled tabs,
dynamic insertion/reordering/removal, focus after record replacement, external
panel associations, and selected-tab action isolation. Application tests retain
the distinct screen-wiring and terminal-preservation risks.

Validation for this slice:

- The component workspace command and the 53-test focused component, application
  composition, owner-state, and terminal-runtime run passed.
- `npm run build` passed; `git diff --check` passed.
- The full default `npm test` ran 253 tests: 226 passed and 27 failed. All failures
  are source-text assertions in `test/command-contract.test.js` outside this tab
  behavior migration; the full suite is not green.
- Chromium/Vite fixture checks exercised an OpenCode tab, a tool terminal, Docs,
  Change Review, repeated keyboard activation, and selected-tool close. Reader
  selection preserved both terminal DOM nodes; close removed only the tool
  terminal and selected the Workspace terminal. Final fixture diagnostics were
  empty. The workbench axe audit reported zero violations and zero incomplete
  checks. At 720×560, tabs wrapped without document overflow; wide and narrow
  screenshots were inspected.

No native GUI, real PTY/process, provider, or Wayland acceptance ran. The browser
fixture deliberately rejects OS shell handoff; its **Open terminal** action was
not validated as a successful native launch. No Rust behavior or IPC contract
changed.

### Navigation SVG controls (28 October 2026)

Directories now composes the shared decorative folder SVG beside its visible
label instead of a Unicode menu glyph. ActionMenu retains native summary/details
semantics but replaces the browser marker with a shared SVG chevron that rotates
when open. This covers New work and keeps other shared menu triggers consistent.
Button owns the token-based icon/label gap; SVG artwork stays in Icon.

The navigation DOM regression failed on both missing SVGs before the fix, then
passed with accessible labels, decorative/non-focusable SVGs, Directories action
and both New-work choices intact. The focused component/composition/menu run
passed 25 tests; the expanded browser suite passed 12 tests, including actual
16px navigation SVG dimensions, native-marker suppression, and chevron state.
The production Vite build passed. The full default suite reported 225 passed and
28 source-text assertion failures: the 27 from the spacing baseline plus a
session-tab keyboard source assertion affected by concurrent workbench changes
outside this SVG fix. That assertion expects markup no longer present in
WorkbenchShell; this change does not edit that component or tab behavior.

Library documentation and the Directories, New work, and workbench UX specs were
updated. The UX index needs no structural update because destinations and
interaction locations are unchanged. Native Wayland/WebKitGTK rendering, focus,
and marker behavior were not checked; no native/Rust/live-service tests ran.

### Whole-CSS-pixel spacing weights (28 October 2026)

`packages/ui-lib/theme.css` now owns a shared spacing scale used for authored
padding, margins, gaps, and overlay offsets throughout library and application
styles. The shared control recipe is 6px vertically and 12px horizontally.
Typography, control/icon dimensions, process ownership, and commands are
unchanged. Border-overlap and visually-hidden `-1px` margins remain intentional
geometry, not spacing weights. Overridden spacing declarations were removed
instead of adding another override layer.

The existing browser control-parity scenario was extended with an Input and
AppNotice. It failed on the original 6.4px/11.2px control padding before production
changes, then passed with whole-pixel values at both 16px and 20px root fonts.
All 11 browser checks, 30 focused composition/DOM tests, and the production Vite
build passed. The full default frontend suite passed 222 tests and failed the
same 27 pre-existing tests as the pre-change run; no failing names were added.
The full suite is not green. No Rust, installed-OpenCode, or native build ran for
this CSS-only production change.

A one-off PostCSS audit inspected all 22 authored stylesheets and 209 spacing/
position declarations: all referenced spacing tokens resolve, and the only
remaining dimension literals in those declarations are the two documented
`-1px` exceptions. Chromium screenshots of Quick Requests at 1280×577 and
600×560 showed no horizontal document overflow or fractional visible padding/
gaps. At 600×560 the Workspace terminal still reaches the viewport bottom and
its main-area padding is zero. These checks do not establish native appearance
or physical-pixel alignment at other zoom/device scales.

The spacing reference is linked prominently from both UI skills and the library
README. The UX index and affected screen specifications were reviewed and
updated; no screen hierarchy or interaction changed. Native Wayland visual,
focus, overlay, and terminal acceptance remains manual and was not performed.

### New Work modal frame and interactions (28 October 2026)

New Work now composes the shared Modal rather than maintaining a second frame.
The old auto-height capture combined nested flex-fill layouts, while review
forced a viewport-sized height; both could leave unused space. The new frame
uses content-fitting height and removes those competing sizing rules.
The shared primitive owns content-fitting height, compact/wide widths, persistent
header/close and footer, bounded body scrolling, Tab wrapping and opener-focus
restoration. The existing controller still owns cancellation/cleanup and native
open/close; no command, persistence or process behavior changed. Screen-specific
styles and progress styling live beside their components instead of global CSS.

`test/modal-ux.browser.test.js` failed before the fix on the expanding blank area,
missing header close, oversized short review and body-scroll contract. It now
checks these through the real Vite mock entry, plus outside-click protection,
Escape, focus return/containment, review focus, native validation, Shift+Enter,
Enter submission, Back, short-window fit, and long prompt/path scrolling with
stationary actions. `test/ui-dom.test.js` checks native form association, absent
empty-error space and common close/Cancel/Escape callbacks. Existing controller
tests retain cleanup-success/rejection coverage, and the application-composition
scenario covers both creation paths and retained terminal nodes.

The browser audit also caught insufficient primary-button text contrast and a
generic hover rule replacing its foreground. Shared terracotta theme tokens and
the primary hover/pressed rules now keep readable white text; the browser test
audits the modal at rest and on hover. The focused frontend run passed 37 tests;
`npm run test:browser --prefix app` passed 10 tests, and the production Vite build
passed. The default suite passed 222 tests and retained the 27 previously
documented source-text assertion failures; no behavioral-test failures remain.

Browser checks are Chromium evidence, not native Tauri/WebKitGTK, Wayland,
provider or PTY acceptance. Those gates remain manual. The UX screen spec and
library README were updated; the UX index needs no structural change because
New Work remains the same modal over the current destination.

### Presentation library extraction (28 October 2026)

The presentation-only library moved from application source to the private npm
workspace `app/packages/ui-lib/`. Application and browser-fixture imports use
`@ui-lib`; production Vite aliases and editor `jsconfig.json` paths target its
public entry. All test bundles reuse the production alias, including the
real-entry composition test. Architecture checks cover both source roots,
package resolution, matching aliases, and absence of application/Tauri imports
from the library. All moved component, helper, and CSS contents are unchanged.

Validation: 37 focused architecture/composition/DOM tests passed; the default
frontend suite passed 223 tests and retained exactly the same 27 pre-existing
source-text failures (no new failing names). The production build and a clean
offline `npm ci --ignore-scripts` plus build in an isolated temporary copy passed.
Both existing Chromium browser checks passed against Vite dev servers: the Quick
Requests page rendered shared icons, and the control fixture preserved Button/menu
typography through `@ui-lib`. Edited-code formatting and `git diff --check`
passed. These browser checks do not establish native acceptance. Native IPC, PTYs, providers,
Wayland appearance/lifecycle, and separate Rust/installed-OpenCode suites were not
checked. UX specifications need no changes because no interaction or screen
hierarchy changed.

### Frontend directory and filename cleanup (28 October 2026)

Screen code now lives under `app/src/views/<area>/`, with shell composition,
command adapters, terminal code, and browser fixtures in separate directories.
Components use exact-name PascalCase files and dedicated CSS Module stems;
plain JS modules use camelCase. `test/frontend-organization.test.js` failed on
the original layout/casing and now passes. Multi-component files were split
without changing their markup or behavior; the existing UI DOM scenario also
checks that `Notice` and `Status` remain available through the library entry
(now imported as `@ui-lib`).

The real-entry composition, component/overlay, and work-area focused run passed
29 tests. The final default frontend suite passed 222 tests and failed the same
27 source-text assertions as the pre-change baseline (220 passed, 27 failed);
there are no new failing test names. The production Vite build, edited-code
formatting checks, and `git diff --check` passed. A before/after syntax-tree
comparison verified all 365 original JS/JSX declarations/statements apart from
imports, exports, and file locations; all original stylesheets and the command
manifest remain byte-for-byte unchanged.

These checks cover import resolution and composed frontend behavior, not native
IPC, real PTYs, provider calls, or Wayland appearance/lifecycle. No native app,
separate installed-OpenCode test, or separate Rust suite ran for this file-only
cleanup. Existing workflow acceptance gaps remain unchanged. UX index and screen
specifications were reviewed; no user-visible behavior changed.

### Feature-composition refactor (28 October 2026)

`app/test/application-composition.test.js` now exercises the actual Vite entry,
command contracts, existing controllers and single Solid tree in Happy DOM.
It substitutes only the in-memory browser command fixture and terminal renderer;
no native backend, installed OpenCode, provider, user database or local repository
is accessed. The coverage below supplements the older per-flow evidence above;
it does not close their native/Wayland acceptance gaps.

| Affected flow | Composition evidence | Remaining gap |
|---|---|---|
| Initial shell and page lifetime | Entry bootstraps one tree; teardown dispatches pagehide | Actual Tauri IPC, HMR, window/tray and native launch |
| Workspace navigation and session presentation | Repeated selection preserves the same host/surface and attaches once; restart targets the saved session/directory | Actual xterm input/replay/resize, PTY restart, native focus/layout |
| Repository tools | Real menu/controller starts a fixture tool terminal; explicit close forgets it and selects the Workspace tab | Real process startup/cleanup and OS handoff |
| Directories | Navigation opens the composed page and returns without replacing terminal surfaces | Native picker, filesystem scanning, settings persistence |
| Quick Requests | Full-list open/back retains the terminal; New Work cancel/reopen and Quick Request confirmation preserve original prompt presentation | Provider prompt delivery, actual process lifetime, native deletion/confirmation |
| Workspace creation and proposal review | Confirmation selects the new Workspace without replacing existing terminals; empty repository list renders **None** (regression failed before the fix) | Model-backed proposals, provisioning, native setup progress and multi-repository terminals |

Frontend command-inventory and no-raw-invoke architecture checks now scan nested
`.js`/`.jsx` files as well as root modules, including `src/views/` and `src/services/`.

Validation: the 52-test focused composition/controller/session/lifetime suite,
Vite production build, edited-code formatting, and `git diff --check` passed.
The full default frontend suite reports 220 passed and 27 failed; the failing
test names exactly match the 27 pre-existing source-text failures recorded before
this refactor (baseline: 219 passed). Those older markup/formatting assertions
remain outstanding; this is not a green full-suite result. No native app was
launched, and no separate installed-OpenCode or Rust suite was run for this
frontend-only change.

Pre-selection-fix SolidJS item 7 execution (24 October 2026) passed 206 frontend tests, 180
Rust tests, formatting, Vite and native debug compilation, the explicit
7-test installed OpenCode v2.0.28 contract suite, and the Tauri optimized native
release build (bundling disabled); no tests were skipped/ignored. All nine
required commands passed. The exact command ledger and artifact path are in
[`solidjs-refactor-progress.md`](solidjs-refactor-progress.md#item-7-final-gate-execution).
At this pre-follow-up point, no native launch/IPC, GUI/rendering,
interactive terminal/window/tray lifecycle, HMR or provider-backed acceptance
had run. A separate `npm audit --prefix app --json` exited 1 for the high-severity
Happy DOM development-dependency advisory GHSA-834v-8h66-3h79; that advisory was
subsequently resolved by the narrow `happy-dom` 21.0.4 update recorded in the
progress plan and README.

The subsequent Quick Request selection slice passed 56 focused tests. Final
post-fix validation reran `npm test --prefix app` (209 passed, no skips/cancellations),
`npm run build --prefix app` (Vite 6.4.4, 85 modules),
`npm run tauri:build --prefix app`, and `git diff --check`; all passed.
The current optimized artifact at
`app/src-tauri/target/release/opencode-project-manager` embeds the post-fix assets
(bundling disabled). The later Workspace shell-layout repair also passed
`npm test` (209/209), `npm run build`, `npm run tauri:build`, and
`git diff --check`; it is documented above as a seeded Chromium/Vite visual check,
not native Tauri/Wayland acceptance. `npm audit --prefix app` now reports zero
vulnerabilities. Item 7's current automated gate is validated.
Its nonvisual production signal/controller coverage proves selection invalidates
persistent observers without refreshing records, including Workspace clear and
selected deletion. It does not establish rendered highlights or native terminal
preservation. Full Rust/formatting/native debug/explicit CLI/clean-install checks
retain their pre-fix passing baseline scope for unchanged Rust and dependencies;
they were not rerun. No native executable, GUI or browser was launched. Manual
Wayland/native/GUI/provider/plugin acceptance remains open. See the progress
plan's final slices for exact scope and current results.

The model-loader row is the only Node test that launches the installed CLI;
Rust-only vertical fixtures do not constitute cross-language evidence. The
Quick Request signal-form tests exercise the production view/handler/flow and
command adapter, including pending busy, deferred failure, terminal-gate
cancellation and acceptance-before-clear-before-refresh ordering. The retained
compatibility form remains hidden and the visible directory-review flow is
unchanged. Existing DOM-binding tests cover only the legacy fallback; neither
layer proves native form validation, Solid rendering, Tauri IPC or terminal
lifecycle. Shell bootstrap coverage is
production signal-adapter execution plus source
review, not execution of `main.js` in a native WebView. Normal no-selection launch,
navigation, and model initialization remain manual Wayland checks. Tools action
forwarding and synchronous group/action ordering have nonvisual production
coverage, not native menu/terminal acceptance. Progress destination data and
Workspace-list busy ownership have nonvisual checks only; actual capture/review
placement, streamed progress/recovery, navigation rendering, and terminal
preservation still require manual Wayland acceptance. Tab state, ordered restore,
tool-action selection, and keyboard rules now have nonvisual production-helper
coverage; actual tab focus/rendering, native restore/close, and terminal lifecycle
remain manual. Docs now has production signal/controller and pure content-routing
coverage, not the retired DOM renderer tests. A sanitizer double proves routing
only; actual Markdown sanitization, text rendering, and destination/terminal
interaction remain manual on Wayland. Model loading retains the real installed
CLI/server and Rust wire harnesses, but now tests production choice data rather
than obsolete select population. Workspace setup/session recovery is exercised
through the production controller's review/error/action-label callbacks, not a
parallel DOM fallback. Page resource lifetime now has nonvisual production-owner
and real-runtime registration/disposal coverage with external boundary doubles.
This does not establish actual HMR/page-unload delivery, native hide/show/tray,
terminal rendering/input, or process shutdown; those remain manual acceptance.
Other
manual/live gaps by flow are provider/model availability and GUI selector
rendering (model loading), model-backed streaming and approval/form/input
behavior (Quick Request and task sessions), v2 event-loss recovery and real TUI
readiness (session flows), descendant process-group cleanup (shutdown), and
visual/tray/window acceptance on the target Wayland session (hide/shutdown).
