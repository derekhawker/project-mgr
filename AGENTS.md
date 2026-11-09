# Project Principles

- For UI component boundaries, app-specific abstractions, and component styling, follow [UI component design](.agents/skills/ui-component-design/SKILL.md). When extending the presentation library in `app/packages/ui-lib/` (imported as `@ui-lib`), also follow [UI library extension](.agents/skills/ui-library-extension/SKILL.md).
- **Give coherent UI elements clear component boundaries.** Extract an element when separating its presentation or interaction makes the surrounding screen easier to understand or change. Reuse an existing component when it fits. Put product-neutral components in `app/packages/ui-lib/` and application-specific components in `app/src/components/` or beside their screen. Keep product behavior out of the UI library.
- Put application behavior, validation, state changes, persistence, and process ownership in Rust. Keep raw HTML/CSS/JavaScript as presentation and a Tauri-command adapter.
- Read `docs/application-workflows.md` before changing product behavior.
- Workspace/task prompts are transient inputs, never application database/file records. Log their send failures to Tauri's OS-specific `app_log_dir()/application.log` with session/error metadata only; do not write prompt contents to logs.

## Bug Discussions

- When a bug is discussed, first inspect the reported context and accessible evidence, including relevant logs and errors, without changing user data. Confirm only the material unknowns with the user before relying on assumptions or making changes: for UI bugs, the screen or interaction area, preconditions, reproduction steps, and expected versus actual behavior. Preserve safety and obtain authorization before operations that could affect user data or live services.
- For native initial-prompt failures, inspect Tauri's `app_log_dir()/application.log`: on Linux, `${XDG_DATA_HOME:-$HOME/.local/share}/dev.opencode.projectmgr/logs/application.log`; on macOS, `~/Library/Logs/dev.opencode.projectmgr/application.log`; on Windows, `%LOCALAPPDATA%\dev.opencode.projectmgr\logs\application.log`. An application directory override changes the location to `<override>/logs/application.log`. The file may not exist until a failure is logged; inspect terminal stderr and the UI error too. Never copy prompts, credentials, or other secrets into reports or logs.
- For frontend command failures, inspect `window.appDiagnostics()` in the browser/WebView developer console, or `agent-browser console` in the mock browser. These bounded, in-memory records contain command names and categories only and reset on reload; they do not cover failures before frontend startup. UI and other console/stderr messages may contain sensitive details, so review before sharing.

## UX Terms

- For UI names and locations, consult `docs/ux/glossary.md` and the screen map in `docs/ux/index.md` before asking the user to identify an area.
- **Workspace:** A project grouping coupled to one repository. Existing repositories stay where they are unless the user explicitly chooses otherwise. The ticket-first transition and its remaining proof are tracked in `docs/workspace-ticket-workflow-proposal.md`.
- **Ticket:** A Workspace-owned Markdown work record outside Git. Selecting it establishes context; **Work** opens or resumes its OpenCode session.
- **Task:** A retained legacy record, distinct from a Workspace ticket; managed legacy worktrees live under `<task-home>/worktrees/`.
- **Quick Request:** A named one-off tracked item under the special Quick Requests workspace. It is important work with its own status and lifecycle, not a generic label for a user's text or an OpenCode interaction.
- **Prompt:** Text supplied to OpenCode. The initial user text is the **original prompt**; text prepared for a new session is the **starting prompt**. A prompt is not a product record.
- **Interactive terminal:** The user's live interface to an OpenCode session or interactive tool process. Users watch progress and handle follow-ups, approvals, input, and changes there. The terminal is not an app-rendered transcript or a background-only process.

## Implementation

- Default user-facing Tauri backend commands to async orchestration. Put blocking Rust work on a bounded blocking executor. Make explicit exceptions for UI-thread operations and measured, high-frequency lightweight commands.
- Treat `npm run live --prefix app` as a persistent, user-owned development runtime: reuse it and let frontend changes hot-reload. Preserve its launch script and running process; restart or change either only when the work requires it, and explain why first.
- When adding or moving frontend files, follow [frontend organization and naming](app/README.md#frontend-organization): colocate screen code in `app/src/views/<area>/`, use exact-name PascalCase component files, and keep plain JavaScript modules camelCase.
- Before implementation, understand how the intended behavior could work end to end within the current architecture. Identify whether the feature extends an existing feature or calls for a different organization of code. Refine this understanding as implementation reveals more.

## Code Indexing

- When using Codesitter in this repository, keep the frontend and Rust indexes separate: index `app/` with `--lang js,ts,tsx`, and `app/src-tauri/` with `--lang rust`. These are distinct project roots, each with its own `.codesitter` index; run queries against the matching root and use file paths relative to that root. `app/` is the frontend root because it includes its source, tests, and HTML entry point; `app/src-tauri/` is the Rust root. Codesitter skips generated `target/` directories.

## Delivery

- For ticket work, do not create pull requests. Push the ticket branch and squash-merge directly into `main`.

## Testing
- Avoid end-to-end tests; their cost is not justified.
- Test application behavior below the Tauri command-handler layer. Do not call Tauri handlers from tests, since that duplicates framework testing.
- Keep frontend and backend tests within their respective boundaries; do not add tests that span both sides.

### Integration testing
- `npm run live --prefix app` automatically starts `npm run dev`, which provides the mocked integration environment used for integration testing.
