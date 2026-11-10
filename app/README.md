# OpenCode Project Manager app shell

## Local testing and live development

From the repository root, `npm run dev --prefix app` starts the mock Vite
server on `http://127.0.0.1:1420/`. Open it in Chromium or with `agent-browser
open http://127.0.0.1:1420/`. `npm run tauri:dev --prefix app` is an alias for
this same browser-only mock; neither starts Tauri. If the port is occupied, use
`cd app && npx vite --host 127.0.0.1 --port 1439 --strictPort` and open port 1439. Do not attach a live Tauri process to the mock server.

The actual app shell uses deterministic in-memory fixtures for navigation,
Workspace creation, simulated session output, Docs, Change Review and repository
Tools, plus Quick Request directory selection, creation, listing, reopening and
deletion. The full Quick Requests list starts with one seeded long-prompt item
for exercising wrapping and bulk-selection controls. Tool execution creates a
simulated terminal; it never runs a program.
Unsupported commands fail closed, including native picker and OS handoffs.
Reload resets all fixture state. Fixture paths are labels, not real directories.
Quick Request prompts remain only in page memory and are never sent to a
service or written by the fixture; terminal output is canned. The fixture uses
a fixed timestamp and treats its requests as recent for the lifetime of the page.
`npm test --prefix app` runs the default frontend suite without the installed
OpenCode test. It still runs Node, Vite and Rust test harness processes and uses
isolated temporary files. `npm run test:all --prefix app` also runs the
installed-OpenCode model-loader integration and starts a real OpenCode server.

`npm run test:browser --prefix app` uses isolated agent-browser sessions and
temporary Vite mock servers to check icons, control typography, and New Work
modal sizing, scrolling, validation, dismissal, and keyboard focus. It does not
launch Tauri or use application data; native Wayland acceptance remains separate.

**Live data:** `npm run live --prefix app` launches the current native Tauri
build in development mode. It picks a stable, worktree-specific local port so
multiple worktrees can run live at once; if that port is already occupied, it
tries subsequent ports. It opens the normal application database and may start
OpenCode, modify files, run tools, and use network services. The Tauri CLI's
direct `tauri dev` command is also live but uses the fixed port 1420 and the
single-instance handoff; use `npm run live` for concurrent worktrees.
`beforeDevCommand` uses `dev:server` to avoid recursively invoking the native
command. Installed and release builds remain live; `npm run tauri:build --prefix
app` builds them but is not an isolated runtime. Do not run a live mode without
intending its effects.

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

### Opt-in terminal performance harness

This separate development page connects the production `TerminalRuntime` to a
real Rust-owned PTY over a local WebSocket. It does not attach to app sessions,
use the app database, or reproduce Tauri IPC. The PTY starts `/bin/sh -i` in the
system temporary directory. **This is not a sandbox:** commands run with your
user's permissions. Only start it on a trusted machine; do not share the printed
URL. The bridge listens on loopback, requires its per-run random token and the
`http://127.0.0.1:1420` browser origin, and accepts one connection at a time.

With the development server already running at port 1420, run:

```sh
cargo build --manifest-path app/src-tauri/Cargo.toml --features terminal-perf-harness --bin terminal-perf-harness
node app/scripts/terminal-perf-server.js
```

Open the printed URL with agent-browser. Close the page and stop the bridge when
finished. The harness currently fixes the PTY at 80 columns by 24 rows, and its
bridge limits queued input/output rather than implementing production streaming
flow control. It is not a candidate production transport. For a controlled,
idle shell, `terminalPerf.measure(40)` in the browser console sends one character
at a time and reports xterm-input-to-next-PTY-output delivery in milliseconds;
it removes the unsubmitted line afterward. It does not measure physical
keyboard events, parsing, screen paint, native WebKitGTK, or Tauri IPC. It must
not be run while a command is executing. To check the bridge explicitly after
building, run `node --test app/test/terminal-perf-harness.browser.test.js` from
the repository root.

On 31 October 2026, two 40-sample idle-shell Chromium runs through this bridge
measured medians of 0.9 ms and 0.5 ms and 95th percentiles of 7.0 ms and
6.1 ms respectively. These are single sequential echo samples, not a throughput
or paint benchmark. Earlier native user-collected samples used a different
workload and timing probe; they are not an A/B comparison. A matched native
comparison and native keyboard-to-paint measurements remain open.

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
frontend invokes Rust only through `src/services/commandContract.js`. Keep xterm terminal
surfaces stable while Solid updates surrounding presentation.

`TerminalRuntime` attempts xterm's WebGL2 addon by default after opening each
terminal. If WebGL initialization fails or its context is lost, xterm returns to
its built-in DOM renderer without changing PTY/session ownership. This does not
promise a performance gain: browser WebGL smoke checks do not establish native
WebKitGTK availability or acceleration. See
[`../docs/terminal-rendering-research.md`](../docs/terminal-rendering-research.md)
for the decision and manual Wayland comparison protocol.

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

The 27 October 2026 terminal-renderer follow-up passed `npm test --prefix app`
(237 tests), `npm run build --prefix app` (Vite 6.4.4, 113 modules),
`npm run tauri:build --prefix app`, `npm audit --prefix app` (zero
vulnerabilities), and `git diff --check`. A Chromium 153 browser fixture opened a
Workspace terminal, observed an active WebGL2 canvas, forced context loss, and
confirmed xterm remained mounted with rendered output after DOM-renderer fallback.
The refreshed artifact at `app/src-tauri/target/release/opencode-project-manager`
embeds the default-WebGL change. No native Wayland/WebKitGTK terminal comparison
or performance benchmark ran; that acceptance gate remains open.

### Frontend resource lifetime

#### Frontend organization

`src/main.js` connects the selected Workspace/Quick Request, destinations, shared
model loading, and page lifetime. Only this entry and global `styles.css` live
directly under `src/`:

| Directory | Owns |
|---|---|
| `application/` | Application root, shell/status/empty-state components, lifetime, and shared shell styles |
| `views/<area>/` | Destinations and their nested features, local controllers, presentation state, helpers, and CSS Modules |
| `features/` | Cross-destination features such as the New Work menu and modal |
| `components/` | Reusable application-specific controls, grouped page layouts, and file navigation |
| `services/` | Tauri command contract, manifest, and command adapters |
| `terminal/` | xterm runtime, terminal protocol, and stable surface registry |
| `fixtures/` | In-memory browser command fixture |
| `lib/` | Shared keyboard, diagnostics, runtime-mode, error, and model-selector helpers |

The presentation component library lives separately in
[`packages/ui-lib/`](packages/ui-lib/README.md), outside `src/`. Import its public
entry as `@ui-lib`:

```js
import { Button, Modal } from "@ui-lib";
```

It is a private npm workspace package with Solid as a peer dependency. Run
`npm ci` from `app/` to install the application and link the library. Vite's
`presentationAliases` provides runtime/build resolution and is reused by the
test bundles; `jsconfig.json` provides the matching editor path. A paths entry
alone would not configure Vite. The package owns primitives, theme, and generic
interactions; application-specific controls remain in `src/components/`.
Component-owned tab interaction and accessibility tests live under
`packages/ui-lib/test/`; run them with `npm test --workspace ui-lib`. The default
application test command includes that workspace suite. Screen tests retain
only application wiring and terminal-preservation scenarios.

Top-level view areas are `directories`, `ports`, `quick-requests`, and `workspace`.
New Work is a cross-destination feature in `features/new-work/`, with its modal
under `modal/`. Workspace navigation, tickets, sessions, Docs, Change Review,
and Repository Tools each have a folder under `views/workspace/`. The Docs and
Change Review command adapters live with their respective features.
Keep feature-local components with their owner rather than treating every
component as a destination or creating parallel global component/controller directories.
The `createNewWork.js`, `createDirectories.js`, `createQuickRequests.js`, and
`createWorkspaceSessions.js` modules return named views/actions to compose under
`ApplicationRoot`; no feature mounts a separate DOM root. Cross-area dependencies
remain explicit callbacks, and the catalog stays local rather than on `window`.
Rust still owns validation, durable state, Git, and processes.

**Naming:** each named Solid component has its own exact-name PascalCase file,
such as `WorkspaceOwnerPanel.jsx` or `SetupProgressPanel.jsx`. Its dedicated CSS
Module uses the same stem (`WorkspaceOwnerPanel.module.css`). Shared style
modules and plain JavaScript/JSON files use camelCase (`sessionTabState.js`,
`commandContract.json`); directories use lowercase kebab-case. Import screen
files directly and library components through `@ui-lib`. The architecture checks
in `test/frontend-organization.test.js` guard placement, casing, matching alias
targets, package resolution, and the library's separation from application code.

`test/application-composition.test.js` builds the real entry with Vite and drives
the composed Solid tree in Happy DOM using the in-memory command fixture and a
terminal-renderer double. It covers navigation, terminal retention, restart/tool
close wiring, and both creation paths. It does not establish native IPC, actual
xterm/PTY operation, layout, focus, or Wayland acceptance. Screen hierarchy and
workflows are unchanged; proposal review now correctly mounts its repository
list, including **None** when empty.

The directory/casing cleanup changes source locations only. UX index and screen
specifications were reviewed; no screen hierarchy, interaction, or workflow
changed, so those specifications need no update. Historical validation notes may
refer to paths used at the time; the organization above describes current paths.

#### Lifetime ownership

`main.js` mounts one Solid application tree at `#app-root`, owned by one
`createApplicationLifetime`. Feature components are nested in that tree; they do
not mount into separate DOM roots. The same owner starts app event subscriptions,
terminal startup, and the three-second status poll once. Late listener
registrations are unlistened even after teardown; a late terminal import cannot
create another runtime.

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

All production WebView calls go through `src/services/commandContract.js`. Its checked-in
`commandContract.json` is the canonical inventory and validates command names,
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
