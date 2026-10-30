# Tauri blocking-work research

Research only, 29 October 2026. No performance measurement or implementation is
implied. The lockfile currently selects Tauri 2.12.3 and Tokio 1.53.2; verify
behavior against those versions when implementing.

## Findings

- Tauri documents synchronous commands as running on the main thread, while
  `async` commands run as separate async tasks. An `invoke` already returns a
  promise; that alone does not make a synchronous Rust handler nonblocking.
  `#[tauri::command(async)]` also changes scheduling, but does not turn blocking
  operations into async operations. [Tauri commands][commands]
- An async task must yield to let the executor drive other tasks. Tauri's
  `async_runtime::spawn_blocking` delegates to Tokio's blocking pool and requires
  a `Send + 'static` closure and result. Await its join handle and distinguish
  join failure/panic from the operation's own `Result`; propagate both as
  serializable command errors. [Tauri runtime source][runtime], [Tokio blocking][blocking]
- Tokio's blocking pool has a large default limit and queues beyond it. Bound
  expensive parallel work with a semaphore or other admission policy; do not
  hold a permit only until a caller stops waiting while its worker still runs.
  `spawn_blocking` is for work that eventually finishes, not persistent loops.
  Aborting a started blocking task does not stop it; even runtime shutdown can
  wait indefinitely. A queued task might be prevented from starting, but this
  is not guaranteed. [Tokio blocking][blocking]
- Tauri's managed `State` is borrowed. For an async command with borrowed
  arguments its documented workaround is a `Result` return; this does **not**
  make that borrow `'static` for a spawned closure. Move owned request data and
  a cloned `AppHandle` into the closure and retrieve the exact managed type via
  `Manager::state`, or explicitly share owned state. Missing injected state
  rejects the invocation; `Manager::state` on a missing type panics. Keep mutex
  guards short and out of awaits and subprocess work. [Tauri state][state],
  [Tauri commands][commands]
- Events are JSON, lack strong type and capability-based granular control, and
  are not intended for high throughput; global events reach all listeners.
  Channels are designed for ordered streaming. Register event listeners before
  starting work and unlisten on teardown, including SPA navigation. A channel's
  ordered delivery does not itself solve stale requests, cancellation, or
  backpressure in the application. [Tauri frontend][frontend]

## Application to Change Review

`app/src-tauri/src/lib.rs` defines `change_review_load` and
`change_review_full_diff` as synchronous commands. In
`app/src-tauri/src/change_review.rs`, load resolves verified workspace bindings,
then serially validates repositories, calls Git repeatedly and generates a diff
for every changed file using `Command::output` and filesystem reads. Full diff
also performs Git and filesystem work; its separate 1 MiB output/input checks
do not bound execution time. The normal load reads an untracked file before
checking its size and collects Git output; moving threads alone does not bound
memory, duration, subprocess count, IPC serialization, or rendering cost.
`ManagementStore` owns one mutex-protected SQLite connection
(`management.rs`); avoid holding its lock while Git runs and preserve the
verified-owner/path validation and existing partial-repository error behavior.

Recommended incremental approach:

1. Make both review commands async wrappers around one blocking closure per
   request, await it, and preserve their current payloads and error semantics.
   Move the owned request and an `AppHandle` into the worker, obtaining the
   existing `ManagementStore` there. Handle the outer join error explicitly.
   This is an architectural recommendation, not proof that the UI will be fast:
   JSON serialization, `diff2html`, and DOM work can still delay it.
2. Bound concurrent review and full-diff jobs across requests; choose queue,
   coalescing, or rejection behavior deliberately. Avoid unbounded per-file or
   per-repository parallelism. Snapshotting verified bindings before Git can
   shorten database access, but introduces a time-of-check/time-of-use window;
   define behavior if associations change and retain backend authorization and
   path checks. Do not open an independent store merely to avoid the mutex
   without addressing connection consistency and migrations.
3. Protect all UI completion paths with request generations and current owner
   and visibility checks, including errors and `finally`. The controller checks
   workspace identity only after success; an older error or cleanup can update a
   newer view. `DiffView.jsx` already uses a generation for full-diff results,
   but ignoring stale results does not stop the worker. Consider cooperative
   cancellation between repositories/files and admission of queued work. For
   stopping an in-flight Git process, explicitly own the child, define timeout,
   kill and reap behavior, and handle pipe draining; a flag or dropped promise
   cannot interrupt the current `Command::output` or blocking read. Killing
   descendants and cross-platform behavior need separate design and tests.
4. Start with the existing loading indicator and final response. If measured
   latency warrants progress, define request-scoped IDs, completion/error and
   cleanup semantics; prefer a command channel for ordered per-request updates,
   or scoped, low-rate events for notifications. Do not send sensitive diff
   content in broad events. Progressive or lazy diffs change the response/UX
   contract and require separate design rather than being assumed by threading.

Validate with a controlled delayed Git/worker fixture: demonstrate another
command remains responsive, result and errors survive IPC, overlaps cannot
overwrite current state, concurrency is bounded, and cancellation/timeout reaps
children where implemented. Exercise real Git/store safety and native Tauri
IPC separately; browser fixtures do not establish native responsiveness or
Wayland acceptance. Review UX/workflow and integration-matrix documentation if
behavior changes. No such tests or benchmarks were run for this research.

## Primary sources

- [Tauri 2: calling Rust, async commands and channels][commands]
- [Tauri 2: state management][state]
- [Tauri 2: calling the frontend, events and channels][frontend]
- [Tauri 2.12.3 async runtime source][runtime]
- [Tokio 1.53.2 `spawn_blocking` documentation][blocking]

[commands]: https://v2.tauri.app/develop/calling-rust/#async-commands
[state]: https://v2.tauri.app/develop/state-management/
[frontend]: https://v2.tauri.app/develop/calling-frontend/
[runtime]: https://docs.rs/tauri/2.12.3/src/tauri/async_runtime.rs.html
[blocking]: https://docs.rs/tokio/1.53.2/tokio/task/fn.spawn_blocking.html
