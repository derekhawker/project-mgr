# Crash diagnostics

## `npm run live` output

Every `npm run live --prefix app` invocation creates a separate run log in the shared Tauri app-log directory:

```text
<Tauri app_log_dir>/live-runs/live-<UTC-start>-<launcher-PID>-<run-ID>.log
```

`<UTC-start>` uses `YYYYMMDDTHHmmssZ`. `live.js` prints the exact path at startup. The header records the canonical worktree path, Git revision at launch, launcher PID, and run ID; it adds the Tauri CLI PID after spawn. Captured output includes Tauri CLI/dev subprocess stdout and stderr (Vite, Cargo, and native app), forwarded to the terminal in real time. The native app emits a `PROJECT_MGR_LIVE_PROCESS pid=<PID> run_id=<ID>` marker at startup, which identifies the native PID for coredump matching. Rust backtraces default to full unless the caller sets `RUST_BACKTRACE`.

Tauri v2's `app_log_dir()` defaults to:

- **Linux:** `${XDG_DATA_HOME:-$HOME/.local/share}/dev.opencode.projectmgr/logs/`
- **macOS:** `~/Library/Logs/dev.opencode.projectmgr/`
- **Windows:** `%LOCALAPPDATA%\dev.opencode.projectmgr\logs\`

`app.appDirectoriesOverride` changes the Tauri log directory; the launcher mirrors that configuration when resolving its pre-launch log path. Run logs are shared across worktrees. Files older than seven days are pruned at the next launch, so an expired file can remain on disk until another launch. Each run log is capped at 25 MiB; a truncation marker is written when possible, while terminal output continues.

## Find the relevant live-run log

Use this procedure before reading a run log. Each `npm run live` launch gets a
different file; do not select the first file returned by a glob or assume the
newest file belongs to the affected worktree.

1. Identify the worktree that ran the affected app. For the checkout currently
   open, run `git rev-parse --show-toplevel`. If the report or coredump points to
   another checkout, use that exact canonical path instead; do not substitute
   the worktree of the current OpenCode session.
2. Identify the incident time from the report or OS crash record. If a native
   coredump PID is available, use the PID procedure below as the exact match.
   Do not require the user to provide a PID; it is optional.
3. List every log for the target worktree and compare each `started_utc` with
   the incident time. The affected run must have started before the incident.
   For an incident in the currently running app, choose the matching run that
   was active at that time. For a past incident, use the run whose captured
   output contains the reported error at that time. Read the selected file only
   after matching its metadata.

On Linux, set `ROOT` to the exact target worktree path and run:

```sh
ROOT="$(git rev-parse --show-toplevel)" # Run from the affected checkout.
LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/dev.opencode.projectmgr/logs/live-runs"
for f in "$LOG_DIR"/live-*.log; do
  [ -f "$f" ] || continue
  grep -qFx "worktree=$ROOT" "$f" || continue
  printf '\n=== %s ===\n' "$f"
  grep -E '^(started_utc|worktree|revision|launcher_pid|run_id)=' "$f"
done
```

This prints metadata for **all** runs from that exact worktree, not an
arbitrary first match. Match `started_utc` to the incident before choosing a
file. If the affected worktree is not the current checkout, replace the `ROOT`
assignment with its exact path, for example `ROOT="/home/me/worktrees/feature"`.
If the issue report gives no worktree or incident time, inspect the available
candidate headers and output for the reported error; if more than one run still
fits, ask which run or incident time is intended rather than guessing. A run
started before this logging feature was installed has no run log, and logs do
not retroactively capture output.

On Linux, find a run log for a coredump PID with:

```sh
PID=1782997
coredumpctl info "$PID" # Confirm executable and crash time.
LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/dev.opencode.projectmgr/logs/live-runs"
grep -lF "PROJECT_MGR_LIVE_PROCESS pid=$PID " "$LOG_DIR"/live-*.log
```

Replace `1782997` with the coredump PID. The explicit startup marker is the reliable correlation key; it is not a Rust panic-format assumption. If there is no match, the process may have crashed before emitting its startup marker, the log may have expired, or capture may have failed. Use `coredumpctl info <PID>`'s executable and timestamp to narrow candidate logs; do not guess from another worktree. The recorded revision is launch-time context and may not identify source changes made while the process remained running.

- **App log:** `app_log_dir()/application.log` is a separate file containing selected structured application diagnostics, not a complete Rust log stream. Linux `${XDG_DATA_HOME:-$HOME/.local/share}/dev.opencode.projectmgr/logs/application.log`; macOS `~/Library/Logs/dev.opencode.projectmgr/application.log`; Windows `%LOCALAPPDATA%\dev.opencode.projectmgr\logs\application.log`. Tauri directory overrides apply. The file may not exist or cover the failure.
- **Frontend command errors:** `window.appDiagnostics()` in the WebView console; `agent-browser console` in the mock browser. In-memory only; resets on reload and misses pre-startup failures.
- **Native crash:** Linux `journalctl -b` and `coredumpctl info <PID>`; macOS `~/Library/Logs/DiagnosticReports/`; Windows Event Viewer → **Windows Logs > Application** (WER dumps exist only when available/configured).

Run logs preserve raw process output and may include sensitive material printed by tools. Do not intentionally print or log prompts, PII, credentials, secrets, environment dumps, or process command lines. Review logs and dumps before sharing; never include prompt contents.

### Opt-in WebKit custom-protocol tracing

For a future Linux `npm run live` reproduction, enable Wry's custom-protocol
callback spans for that run:

```sh
PROJECT_MGR_TRACE_WEBKIT_PROTOCOL=1 npm run live --prefix app
```

The captured live-run log will contain `webkit-protocol-span-start` and
`webkit-protocol-span-end` events with a process-local span ID, Wry span name,
thread ID, and elapsed milliseconds. This identifies callback/handler timing
around Wry's WebKit URI-scheme handling. It does **not** include the URI, request
or response contents, status, response size, or the later GLib main-context
response completion; it cannot identify the request URL or prove the source of
heap corruption. Tracing is opt-in because enabling it installs a process-wide
tracing subscriber, and output is captured in the normal per-run live log.
