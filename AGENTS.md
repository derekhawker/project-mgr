# Project Principles

- Put application behavior, validation, state changes, persistence, and process ownership in Rust. Keep raw HTML/CSS/JavaScript as presentation and a Tauri-command adapter.
- Test both ends of every Tauri command: Rust tests cover behavior and serialized results; frontend tests cover command names, payloads, and result/error handling.
- Keep layout, rendering, terminal, window, tray, and visual lifecycle acceptance manual on Wayland for now. Automate these only when the user reopens that decision.
- Preserve Tauri, raw HTML/CSS/JavaScript, and OpenCode-owned conversation history. Read `.opencode-handoff.md` and `docs/application-workflows.md` before changing product behavior.
