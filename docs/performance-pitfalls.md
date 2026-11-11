# Performance Pitfalls and Safe Patterns

Use this checklist when changing Rust/Tauri commands, filesystem or Git work,
startup, or frontend flows. Keep the UI responsive first; optimize measured
bottlenecks rather than guessing.

## Tauri and startup

- **Synchronous command does slow work.** A non-`async` Tauri handler runs
  filesystem, Git, process, network, or substantial database work on an
  execution path that can stall the WebView. Use async orchestration and move
  blocking work to a bounded blocking executor. Keep only measured, lightweight
  operations synchronous.
- **Async wrapper still does blocking work.** Calling blocking code directly
  inside an `async fn` still occupies a runtime worker. Await the bounded
  blocking operation; do not disguise synchronous work with an async signature.
- **Startup waits for optional work.** Do not make window creation or first
  render wait for repository scans, service discovery, model lookup, or recovery
  that can continue in the background. Render a usable shell, then report
  progress and errors through the existing UI flow.
- **Unbounded background work.** Spawning one task or process per path, repo, or
  request can exhaust CPU, file descriptors, or the blocking pool. Bound
  concurrency and queue pressure; preserve ordering where shared state requires
  it.

## Filesystem and Git

- **Walk generated trees.** Prune known dependency, build, and generated-output
  directories before enumerating descendants. Stop descending once a verified
  repository root is found. Keep explicitly selected roots eligible.
- **Canonicalize every child.** Repeated path resolution during a no-symlink
  walk adds filesystem calls. Resolve the selected root, avoid following child
  symlinks, and reuse stable child paths when that is safe.
- **Run heavyweight Git checks during discovery.** Full status, cleanliness,
  worktree, or submodule checks for every candidate multiply process and I/O
  cost. Use the smallest Git facts needed to identify a discovery candidate;
  reserve full validation for workflows that depend on it.
- **Repeat overlapping work.** Deduplicate canonical roots and paths, and avoid
  rescanning nested roots already covered by a broader scan when semantics allow.

## UI and data flow

- **Gate rendering on slow commands.** Start independent startup requests
  concurrently, render useful loading or unavailable states, and let the user
  continue using unrelated controls while they finish.
- **Large synchronous frontend work.** Avoid parsing, sorting, or rendering
  unbounded results in one UI turn. Bound results, paginate, or move computation
  to Rust/background work; preserve responsiveness during updates.
- **Per-item database work.** Avoid repeated queries or transactions inside
  large loops when a batch query or transaction preserves the same semantics.
  Keep database access serialized where required by the store.

## Verify before calling it fast

- Trace the full path from user action or startup through the Tauri handler to
  filesystem, Git, database, and UI updates; async syntax alone is not evidence
  that the UI stays responsive.
- Reproduce with representative fixtures, including large generated trees and
  failure/slow-service cases. Measure traversal, Git, persistence, and visible
  UI responsiveness separately where practical.
- Validate the actual `npm run live --prefix app` native app for Tauri/UI
  responsiveness. Rust tests and browser fixtures do not prove that native
  command work leaves the WebView responsive.
- Record the environment and results. Treat local timings as observations, not
  general performance guarantees.
