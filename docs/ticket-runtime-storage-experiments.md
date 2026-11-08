# Ticket runtime and Markdown storage: executable feasibility research

**Date:** 2026-11-07. **Status:** research only; no production implementation,
installation, service change, or migration authorized.

## Outcome

**A short-lived Rust command adapter is a feasible default for ticket operations
while the GUI is absent. Canonical Markdown plus a SQLite operational journal is
feasible for cooperating writers, but is not a cross-resource atomic transaction
and requires recovery across the two stores.** The experiments
prove process-crash recovery on this host, not power-loss durability, native GUI
acceptance, or a fully managed OpenCode integration.

Recommend shared Rust core logic with an in-process Tauri adapter and a separate
JSON-stdio executable invoked by the OpenCode-side plugin. Keep the plugin alive
in OpenCode, not in a GUI window; do not add an independent project-mgr daemon
merely to keep ticket records accessible. Do not promote this transport choice
into a claim that stdin authenticates an OpenCode session or a human approval.

### Inputs and settled user direction

Read repository `AGENTS.md`, the [product proposal](idea-first-project-mgr-proposal.md),
the [operating protocol](ticket-session-protocol-proposal.md), and both existing
[workflow](opencode-workflow-integration-research.md) and
[tool-observation](opencode-tool-observation-research.md) research appendices.
This report does not edit or supersede those documents.

The latest user decisions constrain this research:

- **Tickets must be Markdown**, outside and independent of code repositories;
  database-only tickets or Markdown-as-export are not alternatives here.
- **One release includes the core feature set and migration**; multi-repository
  execution is deferred to release 2. Internal implementation slices do not mean
  shipping an incomplete first release.
- **Repository-free notes collections/workspaces support optional tickets.** A
  collection does not need a repository, ticket, session, branch, or lifecycle.

Older proposal passages leaving ticket format open are therefore not an open
research question. Migration mapping and release acceptance were not tested here.

## Hypotheses, experiments, observations, verdicts

| Hypothesis | Executable experiment / primary-source check | Observations | Verdict |
|---|---|---|---|
| **H1:** one Rust core and store can serve GUI and plugin callers without the GUI or a new persistent project-mgr daemon. | Build a real Rust library, JSON-stdio adapter, and second in-process-core caller; update in one process and read in another. Compare 25 one-shot calls with 25 calls through one owned persistent pipe. | Revision 2 survived process exit; independent binaries read the same Markdown/journal. The second binary started no GUI. One-shot median 2.572 ms; persistent-pipe median 0.683 ms on tmpfs. | **Accepted as mechanism feasibility.** Actual Tauri integration and installed OpenCode plugin/packaging remain unvalidated. Persistent authenticated service performance was not measured. |
| **H2a:** cooperating writers can detect conflicts without losing an update. | Race two independently running adapters behind a start rendezvous, using the same expected revision/hash, in 20 isolated fixtures. | Exactly 20 applied writes and 20 `revision_conflict` rejections; one operation row and one complete winning Markdown document per fixture. Writer A won 18; B won 2. | **Accepted within the cooperative-lock protocol.** Not a fairness or throughput result. |
| **H2b:** durable-intent design can recover after process interruption and idempotent retry. | Stop after staging, committed intent, file replacement, or DB acknowledgement; additionally SIGKILL after intent and replacement. Reopen through the real core. Retry the same operation ID. | Each final ticket reached revision 2 once, with one applied receipt. A pre-intent orphan stage was reused only after exact-byte validation. Pending file-written/DB-unacknowledged work was finalized without another write. Ten further identical retries created no extra row. | **Accepted for the exercised process failures.** Physical durability is **not established**: fixtures were on tmpfs; no OS crash, reboot, disk-full, or power-cut tests ran. |
| **H2d:** a SQLite backup alone is a consistent ticket-store backup. | Take an online DB snapshot, then change Markdown via the adapter, then compare the copied DB hash against current Markdown. | DB snapshot and later Markdown did not match. | **Rejected.** A combined backup barrier or verified snapshot protocol is required. |
| **H3a:** a child adapter can avoid a network listener and distributed network credentials. | Node `spawn` with executable/argument array, `shell:false`, private pipes, restricted fixture environment; real Rust child processes return success and errors. Inspect official plugin lifecycle and pinned loader source. | Four child calls exited `0,2,2,0`; each returned one JSON line; stderr was empty. Malformed and unsupported requests returned fixed categories without echoing a synthetic canary. | **Accepted as OS-child/stdio feasibility.** No real plugin was installed or invoked; this is not plugin acceptance. |
| **H3b:** private stdin alone proves the runtime caller/session/human. | Supply fabricated caller labels to the fixture; compare with actual plugin runtime context documented in the hook/tool APIs. | Fabricated labels did not become verified identity; the deliberately unauthenticated fixture accepted an ordinary read with them. | **Rejected as an authentication claim.** Trust the installed adapter plugin to capture actual runtime context, then validate bindings/authority in Rust; no OS-user adversarial isolation is claimed. |

“Accepted” means the stated bounded hypothesis survived this experiment, not that
production code, the whole operating protocol, or a release is accepted.

## Reproducible primary evidence

All executable code and fixture data live only at:

```text
/tmp/opencode/ticket-runtime-experiment-2j31q2j3/
  Cargo.toml, Cargo.lock, README.md
  src/lib.rs                 shared journal/store logic
  src/main.rs                one-shot JSON adapter; optional pipe loop
  src/gui.rs                 second in-process-core caller, NOT a GUI
  node-child.mjs             child-process capability/error probe
  run.py                     bounded, one-command experiment runner
  runs/run-rhpqj1dl/          final retained fixtures and results.json
```

The scratch directory is its **own temporary Git repository**, not a project-mgr
branch or worktree. Branch: `throwaway-runtime-storage`; commit: `9a9b0a2`.
That commit captures the source, lockfile, final `results.json`, and build output.
Raw Markdown/SQLite fixtures remain in the run directory. Nothing was pushed.
The temporary repository is on **tmpfs**: retained for inspection, not a durable
archive across reboot. Preserve it separately before reboot if continued access
to the throwaway artifacts is needed.

One-command rerun, from any directory:

```sh
python3 /tmp/opencode/ticket-runtime-experiment-2j31q2j3/run.py
```

The runner uses cached dependencies, builds offline, and retains a new unique
`runs/run-*` directory rather than deleting previous evidence. Exact build:

```sh
cargo build --offline --locked
```

Filesystem check, which returned `tmpfs` with exit 0:

```sh
findmnt -T /tmp/opencode/ticket-runtime-experiment-2j31q2j3 -n -o FSTYPE
```

Environment: Linux x86-64, kernel `7.3.1-1-cachyos`, Rust `1.98.0`, Python
`3.14.9`, Node `v24.20.0`; Rust bundled SQLite `3.46.0`, Python SQLite `3.54.0`.
Scratch direct dependencies are `rusqlite 0.32.1`, `serde_json 1.0.154`, and
`sha2 0.10.9`; these are cached prototype inputs, not dependency recommendations.
SQLite used `journal_mode=DELETE` and `synchronous=FULL`. WAL was not tested.
Before choosing WAL in production, check the SQLite version: the official WAL
documentation records the WAL-reset fix in 3.51.3 and specified backports. [S5]

### Exact final run counts and exit statuses

- Runner exit **0**, Cargo build exit **0**, **16 experiment groups**, **35 isolated
  fixture stores**. These are research scenarios, not production unit tests.
- **139 one-shot adapter processes:** 108 exited 0, 24 exited 2 for expected
  rejections, 5 deliberately exited 70, and 2 were SIGKILLed (`-9` in Python).
- Separately: one shared-core caller exit 0; Node harness exit 0 with four child
  exits `0,2,2,0`; one persistent-pipe process exit 0 after 25 successful requests.
  Total: **169 request attempts** across adapters/core caller, including
  interrupted attempts and one malformed JSON request rejected before core dispatch.
- Two-second lock contention returned `store_busy`, then a later process reopened
  successfully after the fixture lock was released.
- One-shot 25-read range: **2.284–2.937 ms**; persistent-pipe 25-read range:
  **0.590–1.818 ms**. Both reopen SQLite per request; these unoptimized tmpfs
  timings only show that startup was not an immediate feasibility blocker.
  They do not compare production Tauri calls with an authenticated network server.
- All captured adapter stderr was empty. Only intentionally authored synthetic
  ticket text was stored; no live app DB, prompts, transcripts, provider calls,
  credentials, or raw OpenCode tool inputs/results were used.

An initial runner invocation exited 1 because its retry mistakenly retained the
research `stop=after_stage` injection, so it deliberately stopped again. The
runner was corrected to remove that fault flag on retry; later successful runs
are retained too. This was a harness correction, not a production bug or a
storage guarantee. The final committed evidence is the run named above.

The runner gives builds/children deadlines and kills/waits for owned fixture
processes on failure. It starts no listener or background service, runs no
`npm live`, changes no user configuration, and restarts no OpenCode service.

### Independent main-investigator verification

The main investigator read the scratch implementation/runner and reran the
documented command. It exited **0** with the same **16 groups**, **20 cooperating
writer races**, **10 idempotent retries**, expected injected exits/SIGKILL, and
the recorded recovery results. New evidence is retained at
`/tmp/opencode/ticket-runtime-experiment-2j31q2j3/runs/run-mp15cn42/results.json`.
Its timing samples differ and are not substituted for the original run above.
The [readiness assessment](idea-first-implementation-readiness.md) records the
bounded conclusions accepted from this independent run.

The fixture commit is now also preserved in the main repository on the local
research branch listed in the
[fixture inventory](idea-first-implementation-readiness.md#preserved-executable-fixtures).
The scratch-only warning above still applies to later uncommitted run artifacts.

## Storage protocol actually exercised

The prototype intentionally has one fixed `ticket.md`, a minimal Markdown header,
one store-wide stable lock file, SQLite, and staged Markdown. It is not a YAML
parser, ticket lifecycle implementation, or reusable production storage layer.

1. Acquire an advisory lock on **a stable sidecar**, not on the Markdown inode
   that rename will replace. Acquisition has a deadline. Every cooperating core
   read/write/recovery path takes this lock.
2. Recover pending operations before allowing another ordinary operation. Read
   the actual Markdown bytes. Validate both expected numeric revision and
   SHA-256.
3. Write the complete next Markdown to a uniquely named staging file on the same
   filesystem. Sync the file and relevant directories.
4. Commit a SQLite intent containing operation ID, request fingerprint, base and
   intended hashes, intended revision, staging reference, and pending phase.
   **No ticket content or editable lifecycle status is stored in SQLite.**
5. Recheck actual bytes; replace the ticket with rename; sync source/destination
   directories. This is a separate filesystem effect, not part of SQL commit.
6. In a SQLite transaction, finalize the applied receipt and last-observed hash/
   revision. Return the receipt only after that acknowledgement commits.

The underlying guarantees have distinct primary sources: SQLite transactions
serialize writers and commit database changes, POSIX rename replaces one visible
directory entry atomically, and Rust file sync/lock behavior has platform-specific
limits. None of these extends a SQLite transaction to an unrelated Markdown
file. [S1–S4, R1–R2]

### Recovery observations

| Stop point | File / journal immediately after stop | Reopen and retry |
|---|---|---|
| After synced stage, before intent | Old file; no intent; orphan staged Markdown. | Reopen keeps old file. Same request validates/reuses the stage and applies once. |
| After intent commit | Old file; pending intent and staged Markdown. | Base hash still matches: install intended bytes, finalize receipt, return duplicate receipt on same-ID retry. |
| After rename, before DB ack | New file; pending intent. | Intended hash matches: finalize receipt without rewriting the file; same-ID retry returns that receipt. |
| After DB ack, before response | New file; applied receipt. | No recovery effect; retry returns the existing receipt. |
| Pending operation plus external edit | File matches neither base nor intended hash. | Preserve external bytes, retain pending intent, return `pending_external_mismatch`; no blind replay. |

SIGKILL at both committed-intent and post-rename pauses exercised real process
death and OS lock release, not merely an exception in one process. These checks
still do not test a mid-rename kernel failure or persistence through reboot.

The idempotency check fingerprints the logical request, excluding research fault
flags. Ten same-ID/same-request retries retained one row; same ID with changed
content returned `operation_reuse`. A historical receipt says that operation was
applied; it must not be presented as proof that a ticket still has that revision
after later writes or external edits.

### Consequence for `work.begin` and other lifecycle operations

The proposed protocol describes atomically creating a run and setting the ticket
In progress. With canonical status in Markdown and run authority in SQLite, that
cannot literally be one SQLite transaction. A production implementation needs a
recoverable logical operation: reserve a pending run/transition in SQL, install
the guarded Markdown revision, then finalize the authority receipt. A pending
reservation must not grant implementation authority. GUI/tool reads must expose
pending or uncertain state rather than fabricate a completed transition.

The same distinction applies to approval, review and finish. Recovery must
revalidate current binding generation, approved scope and any revocation before
resuming a controlled transition. The prototype only recovers byte replacement
and receipts; it does not prove run-claim atomicity or safe approval recovery.
That protocol wording/implementation gate needs resolution before production,
not an assumption that SQL rollback can undo an already replaced ticket file.

For a simpler first production design, prefer serialized core operations and
explicit discrepancy handling over a general bidirectional sync/merge engine.
Do not copy the prototype's store-wide read blocking unchanged without checking
UI needs: here a pending mismatch blocks even ordinary adapter reads; production
needs a safe read-only view of the canonical file and its recovery warning.

## Sources of truth and operational persistence

Markdown is the **canonical authored ticket and lifecycle representation**.
SQLite is authoritative for **operational receipts and authority**, not a second
editable ticket status. A Markdown `Ready` or `Done` string cannot manufacture a
human approval, execution claim, acceptance, or delivery receipt.

| Data | Persistence needed / ownership |
|---|---|
| Ticket ID, title, scope, decisions, status, acceptance criteria, authored evidence and next action | Canonical versioned Markdown. Stable ID must survive filename/grouping changes; invalid/duplicate IDs need a visible import conflict. Exact schema is not settled by this prototype. |
| Search/list status, previews, tags, parsed fields, file path/hash | Rebuildable index of current Markdown, with stale/invalid flags. A last-managed hash used for external-edit detection is operational baseline data, not another status. |
| Runtime service identity, exact session bindings, binding generation, owner/worker role, assignments, run claims | Durable SQLite facts: not reconstructable safely from Markdown, titles, OpenCode ancestry, or current GUI selection. Prototype does **not** implement these checks. |
| Approval/acceptance/denial receipts | Durable SQLite: verified human-action provenance, exact request and ticket/scope digest/revision, activity and delivery permissions, invalidation/revocation. An editable Markdown approval summary is only a human-readable reference. Not implemented here. |
| Native-resource operations and work-record operations | Durable IDs, request fingerprints, caller/binding generation, phases, base/intended hashes, safe result metadata, uncertainty and reconciliation decisions. Do not persist complete prompts, raw tool input/output, or transcripts. |
| Resource associations and cleanup rights | Durable ownership/adoption/authority receipts and verified identity references; current Git/filesystem facts must still be reread. |
| Workspace/collection membership, manual ranking, repository references | Must survive independently of execution. If not encoded in an authored collection manifest, persist as organization records; they are not necessarily a derived ticket index. Notes-only collections need no ticket rows. Exact manifest/store split remains a design decision. |

Deleting/rebuilding a search index is safe; deleting the operational database is
**not** equivalent. Markdown alone can preserve the work and visible status but
cannot reconstruct verified approvals, session bindings, historical ownership,
or exactly-once receipts. Recovery from DB loss must not guess those rights or
automatically resume execution. Conversely, SQLite alone cannot restore ticket
content: the experiment stores hashes, not full ticket snapshots.

Scope approval should bind a defined canonical scope projection/digest, not only
a user-editable integer. A normal evidence edit need not invalidate scope, while
a material scope edit must. Unexpected external lifecycle/approval changes need
visible reconciliation and withheld managed authority, not a hidden alternative
SQLite lifecycle. That semantic validation remains unimplemented and untested.

### Sidecars, history, and backup

- **Required recovery material:** stable lock sidecar, pending intent, and staged
  intended Markdown. Stages are immutable recovery artifacts, not editable live
  tickets. Orphans, missing/corrupt stages, permissions and retention need policy.
- **Not provided by receipts:** a complete content history or automatic undo.
  Once replacement removes the old bytes, hashes cannot reconstruct them. If
  history is required, retain bounded immutable Markdown revisions or backup
  snapshots. An app-managed history repository outside code repositories is an
  option, not a requirement or a tested solution. Do not make a Git commit plus
  SQLite update look atomic either.
- **Combined backup:** stop/admit no new cooperating mutations under a backup
  barrier, reconcile or include pending operations, snapshot SQLite through its
  supported API, copy Markdown and required staging/history, and retain a manifest
  of IDs/hashes/schema versions. Check the manifest on restore. The online backup
  API snapshots SQLite, not adjacent Markdown. [S3]
- Cloud-sync folders, multi-machine SQLite access and network filesystems were not tested; WAL requires same-host shared memory. [S5]
- Missing/corrupt operational data should retain readable notes/tickets but
  disable unproven managed authority. Retention, restore UX, history privacy and
  migration rollback need explicit release acceptance tests.

## Runtime transport, trust, and lifetime

### Compare the two practical transports

| Choice | Advantages | Costs / lifetime and trust limits |
|---|---|---|
| **Shared Rust library in GUI + one executable per plugin request** | No project-mgr listener, port discovery, network token, Rust daemon, or GUI prerequisite. Same core rules and store across processes; naturally fits bounded journal transactions. | Package/find the correct platform binary; version the wire/core/schema contract; bound process concurrency, stdin/stdout size and deadlines. Shared disk locking and journal recovery remain necessary. Cannot maintain in-memory subscriptions between calls. |
| **Authenticated long-lived local Rust endpoint** | Can centralize scheduling, connection pools, subscriptions and repeated calls; may help measured high-volume traffic. | Requires an approved owner/start/stop/restart/upgrade policy. GUI ownership fails the GUI-closed requirement unless another host owns it. Unix-domain socket/Windows pipe peer controls or loopback authentication, endpoint discovery, stale endpoints, request authorization and secret lifecycle must be designed. Loopback alone is not authentication; endpoint authentication alone is not a verified human decision. Not built/tested here. |
| **Owned persistent stdio child of OpenCode** | No network endpoint; potentially amortizes process startup. | A third option if measurements justify it, not an independent daemon. Plugin reload/unload must close stdin, cancel/drain/reap the child, and reconcile uncertain receipts. The pipe timing fixture proves neither that ownership implementation nor recovery across actual plugin reloads. |

The one-shot design is simpler for the stated ticket/journal traffic. Start there
unless a measured workload or required subscription cannot fit. Do not add a
general service framework or production traits based on this small experiment.

GUI commands should call the Rust core off the UI thread using the repository's
bounded blocking pattern. The plugin should asynchronously spawn the executable,
not invoke a shell string or block OpenCode's event loop. Its configured absolute
binary/store path must be independent of session cwd and survive session moves.
Never let a model pick an arbitrary executable, store path, or approval mode.

### What identifies the runtime caller

The server-plugin guide places server plugins in the OpenCode server, provides
tool/runtime session context, and documents setup cleanup and cancellation. [O1]
Pinned v2.1.4 source loads plugin modules through the host runtime; local Node and
Bun source loaders use normal runtime loading, not a documented child-process
sandbox. [O2–O4] This supports using the OS child-process API, not a claim of a
special `ctx.spawnRust` API. Node officially documents `spawn`, pipes, direct
argument arrays, deadlines/cancellation, and output backpressure. [N1]

Recommended trust boundary:

1. A trusted installed plugin captures actual `context.sessionID`, call identity
   and service identity; it builds the envelope outside model-controlled input.
2. Rust resolves persisted binding generation, run, assigned role and allowed
   operation; it does not grant authority merely because an envelope names a
   ticket/session or claims `role:human`.
3. A separate verified human-action route produces approval receipts. A generic
   agent-callable command must not self-approve by supplying another caller label.
4. Private parent/child pipes reduce exposure: no listener or application network
   secret needs distribution. They do **not** cryptographically prove OpenCode
   ancestry/session identity to a program any same-user process can execute.

The scratch adapter intentionally implements no binding/approval authentication;
its fabricated-label probe is a negative control, not an authorization test.
A same-user shell can invoke the executable and edit Markdown/SQLite directly.
Neither caller labels, parent PID checks, file permissions against other users,
nor a same-user-readable token establish adversarial isolation from that user.
If resistance to unrestricted agent shell access is required, it needs an
explicit restricted capability/OS boundary and a different acceptance gate.

Error replies must be bounded, versioned JSON with fixed categories. The two
exercised invalid inputs produced exactly:

```json
{"error":"invalid_json","ok":false}
{"error":"unknown_command","ok":false}
```

No synthetic canary appeared in those outputs and stderr was empty. This proves
only those error paths. The scratch binary's invocation/panic handling and input
size limits are not hardened; production must also cover launch failure, invalid
UTF-8, oversized messages, corrupt DB/files, timeout, cancellation, broken pipes,
and unexpected panics without exposing input or secrets.

### Lifetime constraints the transport does not solve

- The **OpenCode-side observer** remains responsible for timers/events and calls
  into Rust while the GUI is closed. Rust persists each receipt; a reopened GUI
  reloads facts and refreshes live state. A one-shot Rust process need not own the
  ongoing subscription.
- If both GUI and OpenCode collector are absent, no process observes new events.
  Reattachment must reconcile current facts and show historical attribution gaps.
  A journal does not recreate events nobody recorded.
- Plugin disposal/reload, compatibility drift, missing executable, store
  unavailability and interrupted receipts must degrade managed capabilities
  visibly. Deadlines do not undo native effects; journal first, reconcile before
  retrying uncertain external operations.
- Do not hold a SQLite/file lock across native worktree creation, provider work,
  user approval, or other long-running external effects. Persist intent, release,
  perform the effect, then reacquire/revalidate/finalize.
- This does not settle OpenCode server ownership. Keeping background managed
  work alive after app quit still requires the approved shared/private runtime
  policy; a ticket CLI does not prevent today's app-owned server being stopped.
- Actual terminal/PTY/process ownership, native Wayland rendering, app quit,
  plugin unload, packaging/signing/upgrades, macOS and Windows behavior remain
  production acceptance work. No running app or live session was altered here.

## Consequential decisions still needed from the user

These are tradeoffs to approve, not product intent inferred from feasibility:

2. **Ticket-home ownership and portability:** one app-managed home, user-selected
   homes, or registered external collections? Agree import/link/duplicate-ID
   treatment without making code repositories or Git mandatory.
3. **History and backup promise:** minimal crash recovery or retained authored
   revision history; retention/privacy, combined backup/restore, and behavior when
   Markdown survives but operational authority data does not.
4. **Bridge trust level:** trusted same-user integration, or stronger restrictions
   against unrestricted shell/file access? Also approve the structured terminal
   human-action path rather than treating model-interpreted prose as a receipt.
5. **Runtime ownership:** approve the intended OpenCode shared/private-service
   lifetime independently of the recommendation to avoid a new project-mgr daemon.
6. **Release gate:** the single release still needs core workflows, safe notes-only
   operation, and real historical migration/rollback validation. Mechanical store
   feasibility does not authorize migration or convert this work into a staged
   partial product release. Multi-repository execution remains release-2 work.

## Validation gaps before production acceptance

No real GUI, native terminal, installed OpenCode plugin, model/provider request,
human approval control, lifecycle transition guard, binding-generation guard,
worker authority, native resource operation, migration, or combined restore was
tested. The shared-core caller is a tiny executable, not a Tauri command test.
The persistent child is an owned pipe fixture, not an authenticated service.

Production must additionally cover live caller identity/binding checks and
same-terminal human receipts; first-turn/reload gates (owned by the companion
OpenCode investigation); interrupted/revoked authority during recovery; invalid
Markdown/IDs, missing files/stages, I/O failures and backup restore; historical
migration on isolated copies; process cleanup; cross-platform replacement/sync;
and the accepted native GUI/runtime lifecycle. No database or file test alone
can satisfy those acceptance gates.

Documentation review was limited to the requested research output. No UX or
accepted workflow contract changed, so no UX specification or integration-matrix
row was changed. Findings and unresolved decisions are recorded here for the main
assessment; no production implementation should be inferred from them.

## Primary sources

Fetched on 2026-11-07. OpenCode source is pinned to `v2.1.4`, commit
`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`, as in the companion appendices;
current website documentation may be newer. Scratch source/results above are the
primary evidence for every executable observation in this report.

- **R1:** [Rust `std::fs::rename`](https://doc.rust-lang.org/std/fs/fn.rename.html): replacement, same-mount restriction, and platform differences.
- **R2:** [Rust `File`](https://doc.rust-lang.org/std/fs/struct.File.html), `sync_all`, `create_new`, `try_lock`, `lock` and `unlock`: flushing attempts, atomic new-file creation, advisory/mandatory limits, and release when handles close. Current docs were 1.99.1; the exercised APIs compiled on 1.98.0.
- **S1:** [SQLite transactions](https://www.sqlite.org/lang_transaction.html): one writer, `BEGIN IMMEDIATE`, busy/error/rollback behavior.
- **S2:** [SQLite atomic commit](https://www.sqlite.org/atomiccommit.html): database transaction guarantees and filesystem/hardware assumptions, not transactions over arbitrary adjacent files.
- **S3:** [SQLite online backup API](https://www.sqlite.org/backup.html): consistent database snapshots and backup contention.
- **S4:** [POSIX.1-2024 `rename`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html): atomic visible replacement and open-file semantics; not content-conditioned replacement.
- **S5:** [SQLite WAL](https://www.sqlite.org/wal.html): same-host/shared-memory requirements, persistent WAL file, durability settings, and WAL-reset version fix.
- **O1:** [V2 plugin overview](https://opencode.ai/v2/docs/build/plugins) and [server-plugin guide](https://opencode.ai/v2/docs/build/plugins/server): server location, setup/cleanup, tool runtime context, cancellation and hook lifetimes.
- **O2:** [Pinned core plugin module loader](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/plugin/module.ts): local source/package loading and Promise plugin adaptation.
- **O3:** [Pinned plugin host](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/host.ts) and [Node source loader](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/source.node.ts): module resolution/import and local reload loading.
- **O4:** [Pinned Bun source loader](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/source.bun.ts) and [runtime module integration](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/runtime.ts): normal runtime loader ownership and host-module provision, not an advertised subprocess sandbox.
- **N1:** [Node `child_process`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options): direct asynchronous spawn, stdio pipes, shell distinction, timeout/cancellation and backpressure. Current docs were v26; the probe actually ran on Node v24.20.0.
