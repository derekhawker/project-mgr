# Architecture reference

- The desktop app is Tauri 2: SolidJS/Vite frontend, Rust backend, SQLite for app-owned structured state.
- Frontend calls Rust through `app/src/services/commandContract.js`; keep command invocation isolated there. Put multi-command UI orchestration and user-facing result/error mapping in frontend application services, not view components.
- Rust owns validation, application state changes, persistence, and process lifecycle. Rust integrates with SQLite, Git, the filesystem, and OpenCode's HTTP API/CLI. Treat each as a boundary with failure and compatibility behavior.
- OpenCode owns conversation history; the app stores session associations and lifecycle state, not duplicate transcripts.

## Persistence compatibility

When adding or changing persisted fields, check existing SQLite databases and Markdown/frontmatter records: old data must still parse and remain usable. Provide safe defaults or an explicit migration for missing values. Initialization and backfill must run through a reliable startup/read path, not depend on a UI action that may be unavailable when old data lacks the field.
