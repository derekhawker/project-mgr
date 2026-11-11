# Go desktop replacement research

Initial-wave research for “Explore replacing Rust with Go, including Tauri.”
Scope: replace all Rust-owned behavior; Linux and macOS required; Windows is
not required; preserve 1:1 backend capability, while allowing a different UI.
Sources and framework status checked 10 November 2026. This is research, not an
implementation recommendation or proof of parity.

## Executive summary

Go can replace the backend and own the application behavior. The strongest
low-friction route for this app is **Go + Wails + the existing web UI**: Wails
provides a Go desktop host and uses the platform WebView, but it does not make
the frontend Go. This preserves the current HTML/CSS/JavaScript and xterm.js
investment, while retaining a language/runtime boundary between Go and JS.
[Wails describes its Go backend and web frontend explicitly][wails].

For a more genuinely single-language application, **Fyne** and **Gio** provide
Go-authored widget/canvas interfaces on Linux and macOS, without a web frontend.
That reduces Go/JS interop, but entails rebuilding the product UI and
establishing parity for terminal rendering, accessibility, native integration,
and all the current workflows. Neither is a drop-in Tauri replacement.
[Fyne][fyne] [Gio][gio]

**Assessment:** Go is viable, but a one-language UI is a substantial product
rewrite rather than an obvious simplification. Wails is the lower-risk migration
path, not the single-language answer. If eliminating cross-language UI/backend
interop is a hard priority, prototype Fyne and Gio against a representative
screen and interactive terminal before selecting either. Backend-for-backend,
Go has standard process, filesystem, networking and concurrency facilities;
the difficult work is reproducing this application's safety and lifecycle
contracts, not basic Go capability.

## Repository capability inventory

The durable workflow specification identifies the architecture as Tauri, Rust,
HTML/CSS/JavaScript, Rust-managed PTYs, xterm.js, SQLite, Git, filesystem, and an
OpenCode shared local server. OpenCode owns conversation history; app SQLite
owns records and associations. [Application workflows](application-workflows.md)

The registered Tauri command surface in `app/src-tauri/src/lib.rs` includes:

- OpenCode service/model/session API, proposals, permissions/forms, status and
  event reconciliation, session recovery, and initial/follow-up prompts.
- Attached TUI and shell PTYs: start/attach/replay/write/resize/restart/detach,
  child lifecycle and cleanup; multiple independent terminal types.
- Workspace tickets, workspaces/tasks, Quick Requests, lifecycle/history,
  SQLite persistence, startup recovery, and cleanup jobs.
- Git repository discovery/catalog, clone/worktree/branch setup, safe cleanup,
  change review/diffs, docs discovery/read, OS handoff, and Linux/macOS port
  inspection/stopping.
- Native file/directory selection and app/tray/window integration, preferences,
  validation, and error reporting.

The command list is in `app/src-tauri/src/lib.rs`; contracts and invariants are
documented in `docs/application-workflows.md`. The app's terminal renderer is
xterm.js 5.5 with WebGL attempt and DOM fallback; its tested contract includes
PTY input/output, resize, replay, hide/reopen, XTGETTCAP and cleanup.
[Terminal rendering research](terminal-rendering-research.md)

## Go desktop choices

| Option | UI language/architecture | Linux + macOS evidence | Main trade-off |
|---|---|---|---|
| Wails v3 | Go backend + HTML/CSS/JS webview. Not one language. | Project states Linux (GTK4/WebKitGTK 6 default) and macOS Intel/Apple Silicon. | Best preservation of the existing UI and xterm; retains a JS↔Go bridge and platform WebView dependencies. |
| Fyne | Go API and custom cross-platform widget toolkit; no web runtime. | Official project describes desktop support including Linux and macOS. | Single-language candidate, but app UI and terminal need replacement/revalidation; toolkit widgets are not OS-native controls simply because the app is Go. |
| Gio | Go immediate-mode GUI; custom-drawn UI rather than HTML/webview. | Official project lists Linux and macOS. | Single-language candidate with a different UI model; more bespoke interaction/accessibility and terminal integration work to prove. |

Sources: [Wails v3 release][wailsrelease], [Fyne project][fyne],
[Gio project][gio]. “Native rendering” in Wails refers to the OS WebView, not
native widget controls. Fyne/Gio provide Go UI APIs; this report does not claim
their custom widgets are identical to platform-native controls.

## Parity risks and practical concerns

- **Webview vs widgets:** Wails keeps the current browser-style UI, making it
  the easiest route to visual and interaction parity. It still uses distinct Go
  and JS code and a bridge. Fyne/Gio can put UI logic in Go, but this app's
  information-dense screens, dialogs, keyboard behavior, and focus model would
  need a full port and manual parity review.
- **Terminal:** Keeping xterm.js requires a webview, which points to Wails and
  means retaining frontend JavaScript. A Go-only UI would need a terminal
  renderer/widget that handles the existing xterm feature expectations or a
  deliberate alternative; PTY transport alone is not renderer parity. The
  current app also depends on WebKitGTK-specific WebGL behavior and fallback
  testing. [Terminal rendering research](terminal-rendering-research.md)
- **PTY/processes:** Go's `os/exec` supplies child process management, but exact
  PTY allocation, resize, signal, descendant cleanup, output ordering, replay,
  and platform process identity safety require platform-specific work and
  libraries. The repo's listener termination rules include Linux pidfd and a
  macOS identity recheck; this must be intentionally recreated, not assumed
  from portable process APIs. [Workflow port-safety contract](application-workflows.md#70-inspect-listening-ports)
- **SQLite:** Go's `database/sql` is a standard abstraction, but SQLite drivers
  are third-party. The widely used `mattn/go-sqlite3` driver explicitly uses
  cgo, which adds C toolchain/build considerations. Driver choice, migration
  compatibility, transactions, and data preservation need a spike.
  [Go database/sql][database-sql] [go-sqlite3][sqlite-driver]
- **Git/OpenCode:** Both are subprocess/HTTP integration surfaces. A port must
  retain exact verification and path-containment behavior, partial setup
  recovery, authenticated OpenCode service discovery, versioned API contracts,
  and privacy rules. Go's HTTP/process APIs make these feasible but do not
  supply product semantics.
- **Packaging and OS integration:** Wails explicitly documents Linux GTK4 /
  WebKitGTK and macOS targets. Confirm actual minimum OS versions, WebKitGTK
  distro availability, tray/file-picker behavior, code signing/notarization,
  and package formats in a platform spike. Fyne's official packaging docs
  should be checked for the chosen release line; packaging does not establish
  OS integration parity. Existing app behavior includes tray/background
  lifecycle, folder picker, open-folder/editor, and port controls.
- **Accessibility and maturity:** Official feature/platform claims establish
  target availability, not accessibility coverage, screen-reader behavior,
  keyboard parity, stability under this workload, or long-term maintenance
  suitability. No first-party evidence reviewed here proves these for this app.
  Test with real Linux and macOS users/assistive technology before deciding.

## Suggested next decision gate

Build two narrow spikes, without committing to a migration: (1) Wails with one
existing screen, command/event round-trip, and xterm PTY; (2) Fyne or Gio with
the same screen plus a terminal proof. Compare Linux and macOS packaging,
startup, accessibility/keyboard workflows, terminal protocol behavior, and
bridge failure handling. Separately map every Rust module/command to an owner
and parity test before estimating a full rewrite. Do not infer parity from a
hello-world app or framework platform matrix.

## Sources (primary)

- [Wails v3.0.0 release](https://wails.io/blog/wails-v3-released/) — Go/web
  architecture, supported desktop platforms, GTK4/WebKitGTK Linux default.
- [Wails official documentation](https://wails.io/) — framework overview.
- [Fyne official project](https://fyne.io/) — Go toolkit and platform scope.
- [Fyne official packaging documentation](https://docs.fyne.io/started/packaging)
  — packaging commands and platform-specific requirements.
- [Gio official project](https://gioui.org/) — immediate-mode Go UI and platform
  scope.
- [Go `database/sql` documentation](https://pkg.go.dev/database/sql) — standard
  SQL interface.
- [go-sqlite3 official repository](https://github.com/mattn/go-sqlite3) —
  driver and cgo requirement.
- [Go `os/exec` documentation](https://pkg.go.dev/os/exec) — subprocess API.
- [Tauri v2 architecture](https://v2.tauri.app/concept/architecture/) — current
  Rust + WebView architecture for comparison.
- Repository sources: [workflow contract](application-workflows.md),
  [terminal renderer research](terminal-rendering-research.md), and registered
  commands in `app/src-tauri/src/lib.rs`.
