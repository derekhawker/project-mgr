# Project Principles

- Put application behavior, validation, state changes, persistence, and process ownership in Rust. Keep raw HTML/CSS/JavaScript as presentation and a Tauri-command adapter.
- Keep layout, rendering, terminal, window, tray, and visual lifecycle acceptance manual on Wayland for now. Automate these only when the user reopens that decision.
- Preserve Tauri, raw HTML/CSS/JavaScript, and OpenCode-owned conversation history. Read `docs/application-workflows.md` before changing product behavior.
- Workspace/task prompts are transient inputs, never application database/file records. Log their send failures to Tauri's OS-specific `app_log_dir()/application.log` with session/error metadata only; do not write prompt contents to logs.

## Bug Discussions

- Whenever a bug is discussed, in any context, confirm assumptions with the user—especially where it occurs (the screen or interaction area for UI bugs), its preconditions, reproduction steps, and expected versus actual behavior—before proceeding with analysis, investigation, planning, or changes. Proceed once the user has confirmed the relevant context.

## UX Terms

- **Workspace:** A project grouping that knows about zero or more repositories and may contain zero or more tasks. Its repository associations are working context; existing repositories stay where they are unless the user explicitly chooses otherwise.
- **Task:** An optional, independently progressing unit of work nested under one workspace. It may use one or more repositories associated with that workspace; managed worktrees go under `<task-home>/worktrees/`.
- **Quick Request:** A named one-off tracked item under the special Quick Requests workspace. It is important work with its own status and lifecycle, not a generic label for a user's text or an OpenCode interaction.
- **Prompt:** Text supplied to OpenCode. The initial user text is the **original prompt**; text prepared for a new session is the **starting prompt**. A prompt is not a product record.
- **Interactive terminal:** The user's live interface to an OpenCode session or interactive tool process. Users watch progress and handle follow-ups, approvals, input, and changes there. The terminal is not an app-rendered transcript or a background-only process.

## Implementation

- Before implementation, understand how the intended behavior could work end to end within the current architecture. Identify whether the feature extends an existing feature or calls for a different organization of code. Refine this understanding as implementation reveals more.

## Code Indexing

- When using Codesitter in this repository, keep the frontend and Rust indexes separate: index `app/` with `--lang js,ts,tsx`, and `app/src-tauri/` with `--lang rust`. These are distinct project roots, each with its own `.codesitter` index; run queries against the matching root and use file paths relative to that root. `app/` is the frontend root because it includes its source, tests, and HTML entry point; `app/src-tauri/` is the Rust root. Codesitter skips generated `target/` directories.

## Testing

- **Cover risks, not functions.** Before adding tests, identify the changed rule and the regression an existing test would miss. Extend an existing scenario when it can prove the rule clearly. Add another layer only for a distinct risk; neither test counts nor coverage percentages justify duplicate assertions.
- **Choose the cheapest convincing test.** Use input/output tables for pure Rust rules, the production store with isolated SQLite for persistence, and temporary real Git/filesystem fixtures for Git/path safety. Use file-backed SQLite for reopen and migration tests. A selection-persistence test should not provision a clone or start a process.
- **Test both ends of every Tauri command without mirroring business logic.** Rust covers behavior and serialized results; frontend tests cover command names, payloads, and result/error handling. Reuse shared contract checks and, where practical, Rust-produced values in frontend validation. Add command-specific cases for distinct contract risks, not another backend scenario matrix.
- **Make setup reusable and optional.** Reuse small record constructors and fixture helpers; show only scenario-specific differences in each test. Keep database, repository, worktree, and session setup composable rather than building the whole application by default. Each test owns its mutable state and temporary-resource cleanup. Share setup, never the production calculation of an expected answer.
- **Exercise production orchestration.** When a workflow is trapped behind Tauri setup, extract the needed Rust service boundary and keep the handler thin. Substitute only external operations needed to control failures; keep real store/Git integration coverage. Do not rebuild the workflow in the test or introduce a trait/mock for every internal call. Scope testability changes to the feature.
- **Spend extra cases on side effects.** Cover relevant success, rejection before mutation, partial failure, and retry/reopen recovery paths. Check persisted ownership, retained user files, atomicity, and absence of duplicate work. Inject failure where the side effect can fail, then assert recovery through the production entry point. Keep independent failure scenarios independently runnable.
- **Assert behavior, not source spelling.** Use production functions or DOM events for frontend behavior; reserve source-text checks for command inventories and architecture rules. Assert ordering only when correctness requires it. Do not test CSS declarations, classes, or layout in unit tests; keep visual/native acceptance manual on Wayland.
- **Contain boundary-fixture costs.** Reuse a scripted local HTTP server with the real client instead of writing socket parsing per test. Give waits deadlines and reap fixture children on failure. Keep installed OpenCode CLI/server checks explicit and separate from fast deterministic tests; mocks do not replace those integration checks. Provider-dependent acceptance remains manual when automation cannot validate it.
- **Keep migration tests historical.** Build the database using schema/migrations through version N, seed representative data, then run the production upgrade. Do not manufacture an old database by dismantling the latest schema: a new migration should not force repairs to old test setup.

## Post-Implementation

- Validate the intended end-to-end behavior, not just the edited functions. Run focused tests while iterating, then applicable broader and integration suites before completion. Report what actually ran and any manual/unvalidated paths; store or DTO tests do not establish native IPC or GUI acceptance. For workflow coverage changes, update affected rows and gaps in `docs/integration-test-matrix.md`.
- Review relevant documentation against the implemented feature. For UX changes, consult `docs/ux/index.md` and the specification for the affected screen or interaction area; update the area-specific document and keep the index in sync when the UX structure or listed areas change. Update other relevant documentation where behavior, workflows, or terminology have changed. If no documentation change is needed, record why. Do not consider the feature complete until this review is done.
- Consider the feature complete only after the end-to-end validation and documentation review are done.
