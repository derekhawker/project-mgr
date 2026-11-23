# Native GPUI terminal replacement research

**Question:** Can the current xterm.js terminal surface be replaced in a native
GPUI app while retaining Rust-owned OpenCode PTYs on Linux and macOS?

**Recommendation:** Prototype a Project Manager-owned GPUI terminal surface using
[`gpui-terminal`](https://github.com/zortax/gpui-terminal) as the starting point
and [`alacritty_terminal`](https://docs.rs/alacritty_terminal/latest/alacritty_terminal/)
for VT state/parsing. This candidate accepts caller-provided `Read`/`Write`
streams, which matches the current separation where Rust owns each PTY and
session. It is not ready to adopt unchanged: its README explicitly lists mouse
selection and scrollback navigation as missing. Treat it as a fork/extension
candidate and reject it if the prototype cannot meet the acceptance checks below.

This is a candidate recommendation, not evidence that it already matches xterm.js
or that GPUI APIs and packaging have been validated in this app.

## Current terminal contract

The current Rust side uses `portable-pty` in
[`app/src-tauri/src/terminal.rs`](../app/src-tauri/src/terminal.rs). It owns the
child process, PTY reader/writer, resize, exit/error handling, and bounded
startup replay. It launches OpenCode with `TERM=xterm-256color`, truecolor, the
exact server/session/directory, and the service password in the child
environment. PTY output is session-keyed and replayed when the view attaches.

The frontend in [`app/src/terminal/terminalRuntime.js`](../app/src/terminal/terminalRuntime.js)
creates xterm, routes terminal output by exact session ID, buffers output before
mount, forwards input, fits/resizes the PTY, handles XTGETTCAP, and keeps terminal
surfaces alive across hide/reopen. Any replacement must preserve this behavior
without transferring process ownership to the widget.

## Candidate comparison

| Candidate | What it provides | Fit and blockers |
|---|---|---|
| **`gpui-terminal` + `alacritty_terminal`** | GPUI terminal view; VTE parsing; ANSI/256/truecolor styles; keyboard input; OSC 52; push-based IO; caller-provided `Read`/`Write`; resize callback. MIT OR Apache-2.0. | Best architectural fit for retaining the existing Rust-owned PTY. Must implement/test selection and scrollback, both listed as missing. VT behavior and OpenCode TUI compatibility are unproven. Recommend as first prototype base, not as a drop-in. |
| **Zed `terminal_view` + `terminal` crates** | A real GPUI terminal UI with selection, scrolling, search, clipboard, hyperlinks, focus/IME handling, and an Alacritty-backed emulator. | Strong feature reference, but `terminal_view` is GPL-3.0-or-later and depends on many Zed-internal crates (`editor`, `project`, `workspace`, `theme`, etc.). Reuse means substantial extraction/forking and accepting GPL obligations, not adding a standalone widget dependency. |
| **`gpui-libghostty`** | A rendered native Ghostty terminal as a GPUI child; published MIT adapter; README says Linux/Wayland and macOS support. | Project calls itself alpha and requires Zig plus native system libraries. Public usage demonstrates `Terminal::spawn(command, ...)`, not attaching the app's already-owned PTY. Could become an option only if external PTY attachment and lifecycle integration are proven. |
| **`alacritty_terminal` alone** | Rust terminal state/grid and VTE parsing; Apache-2.0. | Engine, not a rendered UI. A GPUI view must still implement rendering, input, selection, scrolling, clipboard, resize, and lifecycle. |
| **`portable-pty`** | PTY allocation, child process, IO streams, and resize; already used by the app. | Retain as transport/process ownership; it is not a terminal emulator or renderer. |

## Prototype acceptance gate

1. Build and run the GPUI prototype on Linux/Wayland and macOS; record native
   toolchain, library, and packaging requirements.
2. Connect the widget to the current Rust-owned PTY streams. The widget must not
   spawn, kill, or independently own the OpenCode process.
3. Verify attach-after-start buffering/replay, ordered session-isolated output,
   hide/reopen, exit/restart, and multiple simultaneous sessions.
4. Run OpenCode's actual full-screen TUI. Exercise 256-color/truecolor, alternate
   screen, cursor/keypad modes, Unicode/wide characters, bracketed paste, mouse
   reporting, OSC behavior, and XTGETTCAP (`+q4d73`).
5. Verify keyboard/control/function keys, Shift+Enter, IME, paste, focus, and
   copy/selection behavior.
6. Implement and test mouse selection, copy, scrollback navigation, a bounded
   history, and resize-to-PTY behavior. These are blockers for `gpui-terminal`
   adoption, not optional polish.
7. Check clipboard escape policy and accessibility behavior; document gaps.
8. Compare feature coverage, maintenance, GPUI compatibility, native dependency
   burden, and license before choosing to maintain a fork or another implementation.

Do not begin a full UI migration until the terminal gate passes on both target
platforms. If the `gpui-terminal` base fails, the next candidates are a deliberate
Zed terminal extraction (license/coupling decision required) or a Ghostty adapter
that can attach to externally owned PTYs.

## Primary sources

- Project Manager PTY: [`terminal.rs`](../app/src-tauri/src/terminal.rs)
- Project Manager xterm adapter: [`terminalRuntime.js`](../app/src/terminal/terminalRuntime.js)
- `gpui-terminal` [README and API example](https://github.com/zortax/gpui-terminal/blob/main/README.md)
- `gpui-terminal` [crate metadata](https://crates.io/crates/gpui-terminal)
- Alacritty terminal engine [module docs](https://docs.rs/alacritty_terminal/latest/alacritty_terminal/term/index.html)
- Zed [Terminal View design notes](https://github.com/zed-industries/zed/blob/main/crates/terminal_view/README.md)
- Zed [terminal_view manifest](https://github.com/zed-industries/zed/blob/main/crates/terminal_view/Cargo.toml)
- Zed [terminal implementation](https://github.com/zed-industries/zed/blob/main/crates/terminal/src/terminal.rs)
- GPUI Ghostty adapter [README](https://github.com/behzade/gpui-libghostty/blob/main/README.md)
- Ghostty adapter [crate metadata](https://crates.io/crates/gpui-libghostty)
- WezTerm [`portable-pty` API source](https://github.com/wez/wezterm/blob/main/pty/src/lib.rs)
