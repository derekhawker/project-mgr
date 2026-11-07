# OpenCode native-operation experiments

**Date:** 2026-11-07. **Installed release:** `opencode v2.1.4`.
**Scope:** native worktree creation and session movement in one Git repository.
This is compatibility evidence, not approval or implementation of the
[proposed ticket/session protocol](ticket-session-protocol-proposal.md).

## Result

**H1–H4 passed within the tested boundary:** the installed server executed
scripted OpenAI-compatible responses through its real Code Mode interpreter,
retained native executors, and public plugin hooks. The final fixture exited
**0 with 64 passing assertions and no failed assertions**. It made 31 loopback
provider requests, created eight real linked Git worktrees, observed eight
`worktree.updated` events and two `session.moved` events, and stopped its private
server and provider.

This establishes native execution compatibility, **not** production Rust-journal
correctness, external-provider acceptance, universal interception, or native
TUI/Wayland acceptance. The local transport supplies deterministic tool calls;
it is not a real model deciding to follow repository instructions.

| Hypothesis | Executable experiment | Conclusion |
|---|---|---|
| **H1:** retained executors and `execute.before`/`execute.after` observe a native create inside Code Mode even when its result is omitted | Return an `execute` tool call over local HTTP; await native create; return only a fixed string | **Accepted.** Both inner hooks ran; wrapper and after hook saw the same actual directory; outer output omitted it. |
| **H2:** repeated/concurrent inner calls share native identity, while closure-local IDs distinguish operations; gates precede effects | Repeat identical create input sequentially; overlap two differently named creates with `Promise.allSettled`; reject separately in before hook and executor wrapper | **Accepted.** Shared session/message/call tuple, distinct wrapper IDs and directories; rejected calls did not enter native execution or change Git inventory. Concurrent identical-name collision handling was not tested. |
| **H3:** a native error can follow successful creation, requiring uncertainty and inventory reconciliation rather than blind retry | Set the private project's real startup command to `exit 47`; invoke native create; inspect journal, saved inventory, and Git; attempt another create for the pending slot | **Accepted.** Native create errored with a real tree retained; the fixture journal recorded `needs-reconciliation`; a wrapper gate rejected the retry without a second tree. |
| **H4:** a move result is admission, not applied Location; caller, target, source plugin instance, and destination readiness must be distinguished | Read target once immediately after retained native move returns; read again outside the callback; observe applied event; test explicit other-session target and source-only capability disappearance | **Accepted.** The immediate read still showed source, later read/event showed destination. Explicit target moved without moving caller. Source-only capability vanished after move; the privately global bridge activated at destination. |

## Reproduce and inspect

Scratch root, denoted **`S`** below:

```text
/tmp/opencode/opencode-native-experiment-sL53R2
```

One-command rerun, requiring the same installed OpenCode binary, Python 3, and Git:

```sh
python3 /tmp/opencode/opencode-native-experiment-sL53R2/run.py
```

The script creates a new `S/run-<timestamp>/` on every invocation. It does not
reuse or remove earlier trees, databases, or evidence. `S/latest.json` identifies
the latest run. These are deliberately throwaway local artifacts, **not a
repository-owned test suite**; the rerun command needs the retained scratch files.

The final cited run, denoted **`R`**, is:

```text
/tmp/opencode/opencode-native-experiment-sL53R2/run-1794040131043876786
```

| Artifact | Evidence retained |
|---|---|
| `S/run.py`, `S/index.js`, `S/source-only/index.js` | Executable driver, native-wrapper/hook plugin, source-only capability plugin |
| `R/evidence/run.py`, `R/evidence/index.js`, `R/evidence/source-only.js` | Copies of the exact final fixture sources |
| `R/evidence/assertions.jsonl` | 64 named checks, all `ok: true`, including dispatch checks—not 64 independent product guarantees |
| `R/evidence/trace.jsonl` | Allowlisted hook/wrapper identities, actual returned paths, statuses, move readbacks, readiness markers |
| `R/evidence/journal.jsonl` | Fsynced intent/completion/admission/denial/uncertainty records; no prompts or conversation copy |
| `R/evidence/provider.jsonl` | Request path, synthetic case ID, continuation flag, advertised tool names, streaming flag; no request bodies, reasoning, or credentials |
| `R/evidence/events.jsonl` | Only public `worktree.updated` and `session.moved` events |
| `R/recovery-inventory.json` | Saved OpenCode inventory and independent Git directory/common-dir/HEAD/branch facts |
| `R/openapi.json`, `R/binary.json` | Installed wire specification and binary/version fingerprint |
| `R/cleanup.json` | Server PID `320029`, intentional shutdown exit `130`, both owned listener ports closed |
| `S/summary.jsonl` | Run history, including failed fixture attempts; copied into final evidence |

Installed executable: `/home/derekhawker/.opencode/bin/opencode`.
SHA-256:
`ca9b3ee262e33bb4e7aa0e1230dc61086a474c8c8016b980081d0719712fd2e7`.
The binary and `/api/info` both reported `2.1.4`, matching the research pin.
This fingerprints the tested binary; it does not prove complete binary/source
equivalence with tag commit `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`.

## Isolation and actual execution path

**Independent verification:** the main investigator inspected and reran the
driver; it exited **0 with 64 passing assertions**. That run is retained at
`/tmp/opencode/opencode-native-experiment-sL53R2/run-1794040356398638866`.
The fixture sources were then captured in a separate local temporary Git
repository at `S`, branch `throwaway-native-observation`, commit `4857e14`.
This captures source, not a main-project commit or durable cross-reboot archive;
no push occurred. The original cited run remains unchanged. The source commit
has since been imported into the main repository as a local research branch;
see the [fixture inventory](idea-first-implementation-readiness.md#preserved-executable-fixtures).

- The driver builds its child environment from an explicit allowlist, **not**
  `os.environ`. `HOME`, all four XDG state/config/data/cache locations,
  `XDG_RUNTIME_DIR`, and `TMPDIR` point into the new scratch run. Git system and
  global config are disabled. No auth file or user credential is copied.
- Configuration called “global” in this experiment exists only under
  `R/config/opencode/`. It is not the user's OpenCode configuration. Model
  catalog fetching is disabled; updates are disabled. The only selected model
  uses the local scripted provider and a deliberately fake credential.
- The actual launch is the installed binary's
  `serve --hostname 127.0.0.1 --port <ephemeral-port>`, without `--service`.
  All management HTTP requests explicitly target that private URL and use its
  synthetic private-server authentication. No default service discovery, service
  restart, live app runtime, or user session mutation occurs.
- The provider uses another OS-selected loopback port. The server port is
  selected by briefly binding port zero and then released before `serve` binds;
  there is a small port-allocation race, not a production port allocator.
- A new Git repository has one synthetic commit on `fixture-main`. Native
  creation uses OpenCode's **unchanged built-in Git strategy**. The plugin
  retains and calls the existing executor; it does not replace creation with
  `git worktree add` or a fake worktree strategy.
- The Python HTTP provider emits Chat Completions SSE containing `execute`
  tool calls. OpenCode advertises and decodes those calls, runs Code Mode, and
  dispatches `tools.opencode.worktree_create` / `session_move`. Continuations
  return fixed synthetic text. **No test-only RPC dispatch shortcut was used.**
- Each wrapper invocation creates a UUID inside the executor, fsyncs an intent,
  calls the retained executor once, then records its result. Public hooks record
  runtime `sessionID`, `messageID`, **`id`**, tool name, and sanitized results.
  The operation journal is a small JS fixture, not the proposed Rust authority.
- HTTP waits have deadlines, polling has deadlines, Git subprocesses have
  deadlines, and the interruption hold has a 20-second limit. `finally` shuts
  down the owned provider and server process group, with bounded kill fallback.
  Final cleanup confirmed both ports closed. Scratch trees remain for inspection.

## H1: observe the native result that outer JavaScript omits

The provider's first response requests this actual Code Mode body:

```js
await tools.opencode.worktree_create({ name: "omitted" });
return "result intentionally omitted";
```

Final-run evidence:

```text
sessionID = ses_e4ae00f59ffer7hHP03xk0rKSZ
messageID = msg_1b51ff2f80010sBvcZgR1mYRC3
native id = native_H1
wrapper op = 14ff0850-fa80-4efc-856f-d0146e60a673
native directory = R/trees/omitted
```

The trace records outer before → inner before → wrapper/native entry → native
return → inner completed after → outer completed after. The wrapper completion
receipt and inner after output agree. Git confirms a linked tree exists. The
outer structured output contains the fixed string and a completed tool-call
summary, **not the native directory**. No model reporting tool was invoked.

**Conclusion:** result capture need not depend on the model returning or
reporting it. This proves the runtime path for supplied tool calls; whether a
real model follows a nested policy reference remains a different acceptance test.

## H2: shared call identity, separate operations, and admission rejection

Both repeated calls use exactly `{name: "repeated"}`. Both concurrent calls use
the same native tool, with names `parallel-a` and `parallel-b`.

| Native outer `id` | Wrapper-local operation ID | Actual path under `R/trees/` |
|---|---|---|
| `native_H2_REPEAT` | `f2bda441-4333-44cf-ae04-6697a8ac78a5` | `repeated` |
| `native_H2_REPEAT` | `a9eaeb6f-4c0a-4858-8162-e172425827d6` | `repeated-2` |
| `native_H2_CONCURRENT` | `b5a1568b-91e7-4513-a5fa-ddc77771cf23` | `parallel-a` |
| `native_H2_CONCURRENT` | `bfa3f20d-c26d-426c-a016-fce250072560` | `parallel-b` |

Within each pair, **session ID, message ID, and native `id` all match**. Each
wrapper closure retains a different UUID and its own actual native result.
Both concurrent native-entry trace records precede either native return,
establishing overlap rather than merely using a concurrency-shaped expression.

Separate gate cases throw from the Promise before hook (`reject-before`) and
inside the retained-executor wrapper (`reject-wrapper`). Neither case enters
native execution or changes Git inventory. Before-hook denial has **no inner
after hook**. Wrapper denial does have an inner error after hook. In both cases
the outer `execute` after status is `completed`, while its structured output has
`error: true`. Outer completion is not native-operation success.

**Refuted shortcuts:** `(sessionID, messageID, id, tool)` is not a unique inner
operation key; after hooks are not guaranteed finalizers; outer completion does
not establish successful provisioning. No claim is made about concurrent
identical-name collision safety or exactly-once execution.

## H3: actual post-create startup failure and safe refusal to retry

The driver updates **only the private fixture project** through
`PATCH /api/project/{projectID}` with `commands.start = "exit 47"`. It then
requests `partial-startup` through the same real model-transport/Code Mode path.
The command is restored to empty before later success cases.

Observed operation `f5b2e32a-acc4-4010-a28e-1c48696f6132` / native `native_H3`:

1. Fsynced intent precedes native invocation.
2. Native invocation rejects; inner after status is `error`, not completed.
3. `R/trees/partial-startup/.git` exists, OpenCode saved inventory lists it with
   strategy `git`, and Git lists it as a linked tree in the original common repo.
4. Journal records `needs-reconciliation`, category `native-error`, without
   inventing a successful directory result that the native executor never returned.
5. A second model-requested create for that slot is refused by the fixture
   wrapper's pending-operation gate **before** another retained native invocation.
   Inventory stays unchanged and `partial-startup-2` does not exist.

This is the real native startup path failing after creation, not a wrapper
throwing before Git runs. The command is deliberately `exit 47`; assertions
check native rejection and retained effects, not extraction of the nested
process exit code from an internal exception representation.

The retry guard deliberately recognizes three named fixture provisioning slots
and reads their pending/uncertain journal state. It demonstrates a viable
pre-effect refusal seam, **not a general Rust idempotency/locking implementation**.
It blocks until reconciliation; it does not silently resolve ownership, retry
startup, or delete anything. Concurrent ambiguous candidates still require a
real authority/reconciliation design.

### Lost receipt and interruption

- **Lost-receipt approximation:** native `lost-receipt` returns successfully,
  but the fixture deliberately omits the completion journal write. The journal
  therefore has only its intent, even though the model/tool path succeeded and
  the real tree exists. A second create is blocked; independent Git inventory
  detects the retained tree. This models a missing authority receipt. It is
  **not an actual Rust endpoint outage, TCP response loss, or process crash**.
- **Actual interrupt at an artificial window:** after native `interrupt-held`
  returns, the wrapper waits before recording completion. The driver calls the
  installed server's interrupt endpoint with `resume=false`. It returns
  `interrupted: true`; the executor's real AbortSignal fires. The retained tree
  remains, its journal has only intent, and the trace contains **no inner or
  outer after hook for `native_INTERRUPT`**. A later create for that pending
  slot is blocked. This tests real server interruption after native completion,
  not interruption halfway through Git creation or startup.

Final recovery inventory verifies the canonical root plus eight retained linked
trees, all with the same common `.git` directory and starting HEAD. All eight
native-created trees are **detached**; a create result must not be interpreted
as a ticket branch satisfying a branch policy. No uncertain tree was deleted.

## H4: admission, application, target identity, and Location readiness

### Current-session move

For `native_H4_SELF`, wrapper operation
`38685ea3-fd15-4c83-a206-2776ed1b23e2` targets
`ses_e4ae00504ffeLGgrN9KNcKyWPi`:

| Observation | Final-run evidence |
|---|---|
| Native result | `{sessionID: <same target>, directory: R/trees/omitted}` at timestamp `1794040134503` |
| Single immediate target read inside wrapper | `R/repo` before **and after** retained native move returned |
| Source plugin's captured Location | Still `R/repo`; it did not silently become destination |
| Public applied event | `evt_1b51ffb6c003UhOihEO4111PVh`, timestamp `1794040134508`, data target equals exact session, destination `R/trees/omitted` |
| Later application readback | Exact session directory is `R/trees/omitted` |

The five-millisecond difference is an observation, not a timing guarantee. The
callback performs **one read and returns**; it never waits for its own move to
apply. Application confirmation occurs outside that callback. Waiting inside
it could prevent the safe boundary needed to apply the move.

### Another target, rejection, and bridge availability

- Caller `ses_e4ae002dbffeTs6PxOY5kqpiKK` invokes `native_H4_OTHER` naming
  `ses_e4ae002ebffe87SCGk7rC8YxwU`. The native result identifies the **target**,
  and that target's applied Location changes. Caller remains at `R/repo`.
  Authorizing only the caller would not authorize this distinct target.
- A wrapper-denied destination produces no Location change. A separate
  nonexistent destination reaches the native executor and returns an inner
  structured error, also leaving Location unchanged. Rejection before native
  invocation and native validation failure are separate boundaries.
- The bridge is configured in the **private global** config and is observed
  active at destination on a later `execute` call. A second harmless marker tool
  comes from an **uncommitted source-project-only config**, which is absent in
  the new worktree. The marker exists before moving and disappears afterward.
  Source capability availability therefore does not establish destination
  readiness. This fixture detects the change; it does not implement production
  fail-closed readiness enforcement for a missing bridge.
- The eight observed `worktree.updated` payloads each contain only `projectID`.
  The applied move events contain target session and destination, but no wrapper
  operation ID. Events cannot supply the missing per-operation correlation.

## Fixture failures, limits, and decisions

Two initial fixture invocations exited **1**, before the completed runs:

1. Startup polling omitted required private-server authentication and timed out
   despite a listening server. The server was stopped. The fixture was changed
   to explicit synthetic private authentication; no installed code was changed.
2. The driver incorrectly expected `projectID` in the public session Location.
   After 21 passing checks it raised `KeyError`. The driver now obtains the sole
   private project from the actual project-list API. Again, the server was stopped.

Subsequent completed runs passed **46**, **59**, **61**, then **64** checks, each
with driver exit **0**. The final run is the cited evidence, not a claim that the
first fixture ran without correction. Its server's shutdown exit **130** is
separate from the successful experiment exit status.

**Accepted design constraints:** retain/wrap the effective native executors;
allocate a closure-local operation ID; obtain pre-effect authority; retain
uncertainty across errors/interruption/lost receipts; reconcile actual Git and
session facts; confirm moves outside the originating callback; inspect target
identity and destination capabilities explicitly.

**Not established:** production Rust transport/storage/reopen recovery,
multi-client locking, reload/unload/later-transform safety, stale advertised
snapshots, conflicting moves, direct management-API/shell/fetch interception,
native tool removal, direct non-Code-Mode exposure, interrupted Git internals,
external-provider behavior, child/context gates, Rust Markdown runtime, or native
GUI/terminal/Wayland behavior. Child/context and Markdown experiments belong to
separate investigations. Multi-repository orchestration remains deferred.

If those remaining required gates fail, keep the capability disabled for managed
execution, use explicit bridge/app-coordinated native API operations, or require
an OpenCode change. Do not substitute model narration or label observation-only
execution as guarded. No production implementation is authorized by these results.

Only this Markdown file was written in the project repository. No app behavior,
source, global user config, user database, live session, or service was changed.
The existing workflow research and protocol proposal were reviewed; their
production claims remain proposals. No UX or integration-test-matrix change is
appropriate for a scratch compatibility experiment with no installed feature.

## Primary references

- [Tool-observation research](opencode-tool-observation-research.md): exact
  pinned hooks, Code Mode identity, partial failure, move admission, and limits.
- [Workflow integration research](opencode-workflow-integration-research.md):
  Location/context distinction, inventory, and move lifecycle.
- Official V2 [server plugin guide](https://opencode.ai/v2/docs/build/plugins/server),
  [plugin loading](https://opencode.ai/v2/docs/build/plugins),
  [custom providers](https://opencode.ai/v2/docs/providers),
  [configuration](https://opencode.ai/v2/docs/config), and
  [CLI/private servers](https://opencode.ai/v2/docs/cli).
- Pinned `v2.1.4` [native tools](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool/plugin/opencode.ts),
  [Code Mode adapter](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/codemode/tool.ts),
  [Promise plugin adapter](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/adapter.ts),
  [worktree service](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/worktree.ts),
  [session wire contract](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/session.ts),
  [project wire contract](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/project.ts),
  [private-server launch](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/cli/src/server-process.ts),
  and [server authentication](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/server/src/auth.ts).

Current web documentation may advance beyond the installed release. Runtime
claims above cite the actual installed binary, saved OpenAPI, and executable
evidence rather than assuming newer documentation exists in v2.1.4.
