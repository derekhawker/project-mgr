# Project Principles

- Put application behavior, validation, state changes, persistence, and process ownership in Rust. Keep raw HTML/CSS/JavaScript as presentation and a Tauri-command adapter.
- Test both ends of every Tauri command: Rust tests cover behavior and serialized results; frontend tests cover command names, payloads, and result/error handling.
- Keep layout, rendering, terminal, window, tray, and visual lifecycle acceptance manual on Wayland for now. Automate these only when the user reopens that decision.
- Preserve Tauri, raw HTML/CSS/JavaScript, and OpenCode-owned conversation history. Read `docs/application-workflows.md` before changing product behavior.

## Implementation and Testing

- Work on one user-visible vertical feature at a time. If blocked, resolve the blocker or explicitly rescope the feature before switching; do not accumulate partially implemented features.
- Before implementation, understand how the intended behavior could work end to end within the current architecture. Identify whether the feature extends an existing feature or calls for a different organization of code. Refine this understanding as implementation reveals more.
- Use this end-to-end understanding to shape the design and decide what belongs in unit tests versus integration tests.
- Test both sides of every Tauri command. Rust tests cover behavior and serialized results; frontend tests cover command names, payloads, and result/error handling. Where practical, pass Rust-produced values through the production frontend contract rather than relying only on hand-authored fixtures.
- Test integration with real external components where applicable: isolated SQLite databases, temporary filesystem/Git fixtures, and the installed OpenCode CLI/server. Mocks support unit tests but do not replace these integration checks. Keep provider-dependent and Wayland-only behavior manual when it cannot be validated automatically.

## Post-Implementation

- Validate the implemented feature against its intended end-to-end behavior, including relevant success, failure, and recovery paths. Confirm that tests cover the important boundaries identified during design.
- Review relevant documentation against the implemented feature. For UX changes, consult `docs/ux/index.md` and the specification for the affected screen or interaction area; update the area-specific document and keep the index in sync when the UX structure or listed areas change. Update other relevant documentation where behavior, workflows, or terminology have changed. If no documentation change is needed, record why. Do not consider the feature complete until this review is done.
- Consider the feature complete only after the end-to-end validation and documentation review are done.
