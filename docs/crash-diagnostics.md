# Crash diagnostics

## `npm run live` output

**Current state:** `app/scripts/live.js` does not save output. The implementation is specified in the draft ticket `persist-npm-run-live-output-for-crash-diagnosis.md`; until it lands, there is no per-run file to read.

**After implementation:** From the worktree root, each run writes one file to `app/.live-logs/live-<UTC-start>-<live-script-PID>.log`, where `<UTC-start>` is `YYYYMMDDTHHmmssZ`. `live.js` prints the exact path at startup. The file includes the worktree path, Git revision, runner/CLI PIDs, and Tauri dev-process stdout/stderr (including Vite, Cargo, and native-app output). Rust backtraces default to full unless the caller sets `RUST_BACKTRACE`.

Given a Linux coredump PID, set `PID` to that number and run `coredumpctl info "$PID"`. Read the `Executable` path; in this dev build it ends with `/app/src-tauri/target/debug/opencode-project-manager`. Remove that suffix to get the worktree root, then run `grep -lF "($PID)" "$WORKTREE"/app/.live-logs/live-*.log`. For example, executable `/home/me/project-mgr/app/src-tauri/target/debug/opencode-project-manager` means `WORKTREE=/home/me/project-mgr`. If grep returns no path, no matching per-run log is available; do not substitute a log from another worktree. Each worktree has its own `app/.live-logs/` directory.

- **App log:** `app_log_dir()/application.log`: Linux `${XDG_DATA_HOME:-$HOME/.local/share}/dev.opencode.projectmgr/logs/application.log`; macOS `~/Library/Logs/dev.opencode.projectmgr/application.log`; Windows `%LOCALAPPDATA%\dev.opencode.projectmgr\logs\application.log`. An app-data override changes this to `<override>/logs/application.log`. It may not exist or cover the failure.
- **Frontend command errors:** `window.appDiagnostics()` in the WebView console; `agent-browser console` in the mock browser. In-memory only; resets on reload and misses pre-startup failures.
- **Native crash:** Linux `journalctl -b` (use `coredumpctl info <PID>` as above); macOS `~/Library/Logs/DiagnosticReports/`; Windows Event Viewer → **Windows Logs > Application** (WER dumps exist only when available/configured).

Review logs and dumps for secrets before sharing; never include prompt contents.
