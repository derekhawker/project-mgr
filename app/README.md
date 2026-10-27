# OpenCode Project Manager app shell

## Local testing and live development

From the repository root, `npm run dev --prefix app` starts the mock Vite
server on `http://127.0.0.1:1420/`. Open it in Chromium or with `agent-browser
open http://127.0.0.1:1420/`. `npm run tauri:dev --prefix app` is an alias for
this same browser-only mock; neither starts Tauri. If the port is occupied, use
`cd app && npx vite --host 127.0.0.1 --port 1439 --strictPort` and open port
1439. Do not attach a live Tauri process to the mock server.

The actual app shell uses deterministic in-memory fixtures for navigation,
Workspace creation, simulated session output, Docs, Change Review and repository
Tools, plus Quick Request directory selection, creation, listing, reopening and
deletion. Tool execution creates a simulated terminal; it never runs a program.
Unsupported commands fail closed, including native picker and OS handoffs.
Reload resets all fixture state. Fixture paths are labels, not real directories.
Quick Request prompts remain only in page memory and are never sent to a
service or written by the fixture; terminal output is canned. The fixture uses
a fixed timestamp and treats its requests as recent for the lifetime of the page.
`npm test --prefix app` runs the default frontend suite without the installed
OpenCode test. It still runs Node, Vite and Rust test harness processes and uses
isolated temporary files. `npm run test:all --prefix app` also runs the
installed-OpenCode model-loader integration and starts a real OpenCode server.

**Live data:** `npm run live --prefix app` launches the current native Tauri
build in development mode. It opens the normal application database and may
start OpenCode, modify files, run tools, and use network services. The Tauri
CLI's direct `tauri dev` command is also live. `beforeDevCommand` uses
`dev:server` to avoid recursively invoking the native command. Installed and
release builds remain live; `npm run tauri:build --prefix app` builds them but
is not an isolated runtime. Do not run a live mode without intending its effects.

### Diagnostics

Frontend command failures in either mode emit `[app diagnostic]` console entries
and are available as `window.appDiagnostics()` in the browser/WebView developer
console. These contain only timestamp, manifest command name, and a fixed
category, with a 100-entry limit; reload clears them. In the mock browser use
`agent-browser console` and `agent-browser eval 'window.appDiagnostics()'`.
Errors before frontend initialization, native event failures, and background
Rust failures are not comprehensively captured by this buffer. UI messages,
other console messages and stderr can contain sensitive details; inspect before
sharing. Initial-prompt failures additionally use Tauri's OS-specific
`app_log_dir()/application.log` with session ID and a fixed failure message;
paths are in [`../AGENTS.md`](../AGENTS.md#bug-discussions). Old log entries
may predate the fixed-message policy and contain sensitive text.

Browser screenshots and DOM inspection do not establish native Wayland/Tauri,
real PTY, provider, window or tray acceptance.

This production app is a Tauri 2 desktop shell with a Rust core and a SolidJS,
HTML, CSS, and JavaScript frontend built by Vite. On startup, Rust opens and migrates an app-owned
SQLite database in Tauri's per-user application-data directory. The startup UI
invokes `app_shell_info` for Rust/storage status and independently loads navigation,
Quick Requests, and models. Model loading starts an app-owned OpenCode server
through Rust; the shell-status response alone does not establish model readiness.

Workspace Git setup is owned by Rust. Confirmation provisions verified managed
base checkouts and Workspace-owned worktrees. Zero repositories use one home
session; one uses one worker; multiple use an outside-repository Orchestrator and
one empty worker per repository. A nonblank starting prompt targets only the home
session, single worker, or Orchestrator, respectively. No setup MCP process or
prompt-driven Git provisioning is used. The accepted product contract is
[`../docs/workspace-refactor-target.md`](../docs/workspace-refactor-target.md).

The SolidJS UI refactor is tracked in
[`../docs/solidjs-refactor-progress.md`](../docs/solidjs-refactor-progress.md).
Rust remains authoritative for application behavior and state changes; the
frontend invokes Rust only through `src/command-contract.js`. Keep xterm terminal
surfaces stable while Solid updates surrounding presentation.

Startup connection, version, and command-result feedback share a Solid signal
view. Nonvisual tests execute that production adapter for ready, storage-error,
and disconnected responses; they do not establish that the native entry launches.
Bootstrap wiring and parent-first mounts have been reviewed in source. Normal
no-selection launch, navigation, and model loading still need manual Wayland
acceptance.

### Final validation record

The 24 October 2026 pre-selection-fix final-gate run passed 206 frontend tests and 180 Rust tests
with no skips/ignores, Rust formatting, Vite production compilation, native
debug compilation, the separate 7-test installed OpenCode v2.0.28 contract
suite, and `npm run tauri:build --prefix app`. The latter produced
`app/src-tauri/target/release/opencode-project-manager` (path relative to the
repository root); bundling is disabled, so no installer/package was built.
Exact commands and outcomes are tracked in
[`../docs/solidjs-refactor-progress.md`](../docs/solidjs-refactor-progress.md#item-7-final-gate-execution).
These are not native launch, WebView IPC, JSX rendering, terminal, HMR,
window/tray, provider-backed prompt, or coordinator-plugin acceptance. Those
gates remain open; the refactor is not fully signed off.

The final post-selection-fix validation reran `npm test --prefix app` (209 passed,
no skips/cancellations), `npm run build --prefix app` (Vite 6.4.4, 85 modules),
`npm run tauri:build --prefix app`, and `git diff --check`; all passed. The current
release artifact at `app/src-tauri/target/release/opencode-project-manager`
embeds the post-fix frontend assets (bundling still disabled). Item 7's current
automated gate is validated. The full Rust, formatting, native debug, explicit
CLI and clean-install results above remain the pre-fix baseline for unchanged
Rust/dependencies; those commands were not repeated. Selection tests exercise
persistent signal observers and the history controller without DOM rendering.
No native executable or GUI was launched; actual navigation highlight and
terminal preservation still require manual Wayland acceptance.

The high-severity Happy DOM advisory
[GHSA-834v-8h66-3h79](https://github.com/advisories/GHSA-834v-8h66-3h79)
(host code execution) affected `21.0.1` through `21.0.3`. The direct development
dependency and lockfile are now updated to patched `happy-dom@21.0.4` (same major,
Node `>=20`); the `Window` APIs used by test adapters remain unchanged.
`npm ci --prefix app --ignore-scripts`, the 209-test app suite, the Vite
build, and `npm audit --prefix app` all passed after the update. The current audit
reports zero vulnerabilities. See the progress ledger for exact provenance and
command results. This dependency fix does not close the manual Wayland/native,
rendering, terminal, window/tray, provider, or coordinator-plugin acceptance gates.

### Frontend resource lifetime

`main.js` mounts deliberate page-lifetime Solid islands through one
`createApplicationLifetime` owner. Parents mount before child roots; teardown
releases the terminal adapter before disposing roots in reverse order. The same
owner starts app event subscriptions, terminal startup, and the three-second
status poll once. Late listener registrations are unlistened even after teardown;
a late terminal import cannot create another runtime.

`pagehide` (page unload), Vite HMR disposal, and explicit test teardown release
frontend resources. Navigation, terminal hiding, and Tauri's hide-to-tray window
close do not dispose the page owner. xterm surfaces stay attached across ordinary
destination changes. `TerminalRuntime.dispose()` removes event listeners,
disconnects resize observers, disposes xterm instances and their input/protocol
handlers, and clears frontend buffers. Pending attachment continuations cannot
recreate observers after disposal. This sends no terminal-cleanup, session-delete,
database-close, or application-shutdown command. Rust alone owns processes and
durable history associations; explicit user close/delete and full Rust quit keep
their separate lifecycle paths. Old page continuations cannot issue new commands
after teardown.

Nonvisual lifetime tests run the production owner and real terminal runtime with
external registration/timer/render boundaries substituted. They establish release
ownership and async race handling, not actual HMR, native events, rendering,
terminal operation, or hide/show/tray behavior. Those remain manual Wayland checks.

## Prerequisites

- Node.js and npm.
- Rust and Cargo with the desktop target for your platform.
- Tauri platform dependencies. On Arch Linux, install the packages from the
  [Tauri 2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux):

  ```sh
  sudo pacman -Syu --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator librsvg
  ```

  Other Linux distributions should use the package names from Tauri's
  prerequisites for that distribution.
- A Wayland graphical session for manual GUI acceptance.
- An installed OpenCode **v2 CLI**. The production Rust boundary starts
  this executable itself; it does not use a shared OpenCode service.

## Commands

Run from `app/`:

```sh
npm ci
npm test
npm run build
npm run tauri:build
npm run tauri:dev
```

### Manual Wayland acceptance

Visual, window, tray, terminal, and lifecycle checks are manual on the target
Wayland desktop for now. From `app/`, run `npm run tauri:dev`, bring the app
window to the foreground, and inspect the rendered shell and Rust command
response. When checking visibility, first confirm whether another application is
covering the window; an empty screenshot alone is not evidence that the app
failed to show.

See [`../docs/gui-testing.md`](../docs/gui-testing.md) for the manual acceptance
boundary and the decision to defer automated GUI/display tests. Test system logic
and Tauri command contracts with local Rust and frontend unit tests.

Run Rust checks from the project root:

```sh
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo build --manifest-path app/src-tauri/Cargo.toml
```

The production OpenCode integration tests execute both fixture child processes
and the installed CLI/server. Run the complete boundary coverage with:

```sh
cargo test --manifest-path app/src-tauri/Cargo.toml --test opencode_cli_contract -- --nocapture
```

No extra feature or ignored-test flag is required for this suite. It requires
`opencode --version` to report major version 2 and root
`--help` to advertise `--server` and `--session`. The fixture suite separately
regresses the exact `opencode v2.0.27` output that exposed the original parser
bug. Set
`OPENCODE_BIN` to the full path when the executable is not on `PATH` or in the
standard OpenCode install locations. The runtime smoke starts `opencode serve`,
authenticates `/api/info`, reads `/api/model`, and always kills and waits for
the child without sending a model prompt.

### Tauri command boundary

All production WebView calls go through `src/command-contract.js`. Its checked-in
`command-contract.json` is the canonical inventory and validates command names,
payload fields/types, serialized result shape, and errors before the call reaches
Tauri. Rust's `generate_handler!` list and every `#[tauri::command]` attribute
are compared with that inventory by frontend tests; frontend adapter command
names are checked too. The manifest is checked in (it is not generated): Rust
schema extraction is intentionally not automatic, so a new attribute fails the
inventory test until its DTO schema and fixtures are added. This catches
missing adapters and flat-vs-nested payload drift (including
`quick_request_list`, whose payload is `{ request: { history } }`).
Do not import or call Tauri's `invoke` from another module. Add a Rust serde DTO,
its Rust serialization test, the manifest entry, and frontend contract tests
together.

Run the boundary checks with:

```sh
npm test --prefix app
cargo fmt --manifest-path app/src-tauri/Cargo.toml -- --check
cargo test --manifest-path app/src-tauri/Cargo.toml
```

`npm test --prefix app` also runs cross-language response-contract checks: Node
launches Rust DTO harnesses, validates their serialized values with the production
command boundary, exercises the production model loader and choice-data adapter
against the installed OpenCode server, and drives legacy Quick Request form
events in Happy DOM. Docs tests execute the production signal view/controller
and the content adapter's parser/sanitizer routing with boundary doubles, not
rendered JSX or security acceptance. Markdown sanitization, plain-text rendering,
and native Docs interaction remain manual Wayland checks. The two Rust
harness binaries are gated behind `integration-test-harnesses` and are not part
of the shipped Tauri executable.

### Path and Git safety fixture

The I-02 filesystem/Git integration fixture creates temporary repositories and
worktrees, prints their canonical paths and identities, and reports the
non-destructive cleanup classifications. It requires Git on `PATH` and never
removes worktrees or branches:

```sh
cargo test --manifest-path app/src-tauri/Cargo.toml i02_git_path_fixture -- --nocapture
```

The package manifest pins frontend tool versions and `package-lock.json` supports
`npm ci`. `app/src-tauri/Cargo.lock` pins the Rust dependency graph. The Tauri
configuration invokes the same `npm run build` script for its frontend build.

OpenCode and terminal work should follow the documented, version-checked
contract for the installed OpenCode v2 CLI in
[`../docs/opencode-v2-contract.md`](../docs/opencode-v2-contract.md). The v1
prototype details are historical, not live v2 validation. Preserve the
Rust-owned PTY with xterm.js architecture. Native IPC, terminal rendering/input,
and window/tray lifecycle still require the manual acceptance above.
