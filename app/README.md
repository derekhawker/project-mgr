# OpenCode Project Manager app shell

This production app is a Tauri 2 desktop shell with a Rust core and raw HTML,
CSS, and JavaScript frontend. On startup, Rust opens and migrates an app-owned
SQLite database in Tauri's per-user application-data directory. The startup UI
invokes `app_shell_info` and shows that the Rust core and management storage are
initialized. OpenCode and other background services are not started yet.

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
contract for the installed OpenCode v2.0.27 in
[`../docs/opencode-v2-contract.md`](../docs/opencode-v2-contract.md). The v1
prototype details are historical, not live v2 validation. Preserve the
Rust-owned PTY with xterm.js direction; terminal event permissions belong with
the I-04 integration, not this shell.
