# OpenCode Project Manager app shell

This production app is a Tauri 2 desktop shell with a Rust core and raw HTML,
CSS, and JavaScript frontend. On startup, Rust opens and migrates an app-owned
SQLite database in Tauri's per-user application-data directory. The startup UI
invokes `app_shell_info` and shows that the Rust core and management storage are
initialized. OpenCode and other background services are not started yet.

## Production registration MCP boundary

`registration-mcp` is the configurable OpenCode tool boundary for task setup.
It is a stdio adapter over the same app SQLite database; it does not start an
OpenCode server, own sessions, or copy conversation history. Configure the
OpenCode tool entry to run:

```sh
registration-mcp /path/to/management.sqlite3 "$HOME" "${TMPDIR:-/tmp}"
```

The database path, user home, and temporary root are explicit process arguments
so packaging can supply the app's per-user paths. OpenCode remains the owner of
the conversation and invokes this adapter only to report validated setup
results to Rust.

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
cargo test --manifest-path app/src-tauri/Cargo.toml
cargo build --manifest-path app/src-tauri/Cargo.toml
```

The production OpenCode integration tests execute both fixture child processes
and the installed CLI/server. Run the complete boundary coverage with:

```sh
cargo test --manifest-path app/src-tauri/Cargo.toml --test opencode_cli_contract -- --nocapture
```

This test requires `opencode --version` to report major version 2 and root
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
command boundary, exercises the live model selector against the installed
OpenCode server, and drives Quick Request form events in Happy DOM. The two Rust
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

Later OpenCode and terminal work should follow the documented, version-checked
contract for the installed OpenCode v2 CLI in
[`../docs/opencode-v2-contract.md`](../docs/opencode-v2-contract.md). The v1
prototype details are historical, not live v2 validation. Preserve the
Rust-owned PTY with xterm.js direction; terminal event permissions belong with
the I-04 integration, not this shell.
