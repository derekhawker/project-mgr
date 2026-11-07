# OpenCode native-tool observation: focused research appendix

**Date:** 2026-11-07. **Source pin:** OpenCode `v2.1.4`, commit
`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824` ([tag reference][tag]).
This supplements [the workflow integration research](opencode-workflow-integration-research.md)
and informs the idea-first proposal; it does not approve or implement a protocol.

## Conclusion

**A plugin can observe and reject native worktree/move tool calls, including
calls nested inside Code Mode `execute`, in the pinned implementation.** The
model need not call a project-mgr reporting tool afterward. Register public
`ctx.tool.hook("execute.before", …)` / `"execute.after"` hooks, or wrap the
existing native executors through public `ctx.tool.transform`. These are real V2
surfaces, not inferred V1 hook names. [D1–D3, S1–S5]

That does **not** provide exactly-once provisioning, universal interception of
HTTP/shell activity, or a child-created admission barrier. Code Mode inner calls
share their outer call identity; after hooks are not guaranteed finalizers;
worktree events lack session attribution; and move-tool success means request
admission, not necessarily application. Strong tracking therefore needs an
application-owned operation journal, executor-local correlation, current-state
reconciliation, and explicit capability gates. [S1–S9]

Evidence labels below distinguish **documented** current V2 behavior,
**pinned-source** implementation evidence, and **proposed** integration design.
No proposed path was exercised against a provider or live plugin runtime.

## 1. Exact public surfaces and their boundaries

### Tool hooks

The official server guide documents before/after hooks; the Effect guide
explicitly documents rejecting a before hook with `Tool.Error`. Pinned public
types define these payloads (abridged without changing field names): [D1–D3, S3]

```ts
"execute.before": {
  tool: string
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly id: Tool.CallID
  input: unknown
}

"execute.after": {
  readonly tool: string
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly messageID: SessionMessage.ID
  readonly id: Tool.CallID
  readonly input: unknown
} & (
  | { readonly status: "completed"; result: Tool.Result }
  | { readonly status: "error"; error: Tool.Error }
)
```

The call-ID field is **`id`, not `callID`**. Success `result` can contain structured
`output`, display `content`, and `metadata`. The caller identity is not the
target identity: `session_move` can name a different `input.sessionID`;
`subagent` executes in the parent but returns the child ID. Worktree creation
selects the project captured by the native tool's Location. [S1, S3, S6, S7]

**Ordering and rejection:**

- Core awaits before hooks before its tool executor. In an Effect plugin,
  `Effect.fail(new Tool.Error({ message: … }))` prevents that executor from
  running. The Promise adapter converts a thrown/rejected before-hook error to
  `Tool.Error` too. This is a call-local rejection, not a rollback or a stop for
  all other parallel tools. [D3, S1, S3–S5]
- Hooks run sequentially in registration order. Later hooks can change the
  mutable input again. A gate that needs to validate the final decoded arguments
  should also live inside the retained executor wrapper; it cannot assume its
  before-hook input will be the final input. [D2, S4, S12]
- After hooks see normal success and caught `Tool.Error` failures. A before-hook
  rejection occurs outside `executeTool`, so **does not get that call's after
  hook**. Defects, interruption, process death, and an earlier failing after hook
  can also prevent notification. After hooks have no typed failure channel; a
  Promise rejection there is a defect, not an admission veto. [S1, S3–S5]
- After hooks run after native effects and output validation. They may replace
  results/errors, but cannot undo worktree creation or a move already requested.
  Do not rely on them for a guaranteed durable completion receipt. [S1, S12]

### Registry transforms are executor replacement, not lifecycle callbacks

`ctx.tool.transform` is a **synchronous, replayable registry edit**. It can
`get`/`update` the existing tool and replace `tool.execute` while retaining the
original executor in a closure. That executor can perform asynchronous
authorization/journaling before and after invoking the original once. Do not do
operation-time I/O in the transform callback itself. [D2, D3, S10]

Effective registry/hook names are `opencode_worktree_create` and
`opencode_session_move`, while Code Mode spelling is
`tools.opencode.worktree_create(…)` / `tools.opencode.session_move(…)`.
The native direct tool is `subagent`. Its pinned registration uses
`codemode: false`: **it is not normally callable from Code Mode**. If a supported
transform changes its exposure, the common inner execution path still matters;
do not advertise a nonexistent default `tools.opencode.subagent`. [S6, S7, S12]

Each model request captures executable tool definitions. Reloading/removing a
wrapper affects future snapshots, not an already advertised executor. Later
registrations can override the tool, and updates of absent IDs are ignored.
Installation must verify actual effective definitions and ordering; merely
calling `update` proves nothing. [D2, S1, S10]

### Other hooks are not equivalent

- `ctx.permission.hook("evaluate", …)` sees a permission decision only where an
  operation actually asserts permission. Native `worktree_create` does **not**
  assert one, and native `session_move` likewise calls move directly. The
  documented worktree utilities other than removal request no built-in action.
  A permission hook alone cannot observe or veto all these operations. [D2, D4, S6]
- `ctx.shell.hook("create.before", …)` exposes command/cwd/env/timeout/shell,
  **not session/call identity**, and is not a worktree-result hook. A generic
  tool hook around model `shell` has caller identity, but scripts and spawned
  processes are not structured native worktree calls. [D2, S13]
- Session `http.request`/`http.response` hooks concern **provider traffic**, not
  middleware for every management API request. They are not a substitute for
  tool interception. No raw provider payload is needed for this integration.
  [D2, S14]
- Worktree strategy callbacks receive source/destination/branch and cancellation,
  not a caller session, ticket, or tool-call ID. Selecting a strategy changes
  provisioning; it is not an attributable observer of every tool call. [D2, S15]

## 2. Code Mode coverage, and the call-ID trap

Pinned execution chain: [S1, S2]

```text
Tool.Snapshot.execute(outer execute call)
  -> tool.execute.before(tool = "execute")
  -> CodeModeTool.execute
     -> registered tools.opencode.worktree_create(input)
        -> tool.execute.before(tool = "opencode_worktree_create")
        -> native/wrapped executor
        -> tool.execute.after(inner result/error)
     -> Code Mode returns its composed output
  -> tool.execute.after(outer result)
```

Core explicitly supplies the before/after execution callback to Code Mode;
Code Mode invokes it for each registered inner tool. It passes **the same
`Tool.Context`** into each invocation. Thus all inner calls in one outer
`execute` share `sessionID`, `messageID`, and `id`, including concurrent or
repeated calls to the same tool. The private `callIndex` is used to collect
files, not exposed as a public inner-call ID. [S1 lines 245–249, 264–281;
S2 lines 89–118]

Consequences:

1. `(service, sessionID, messageID, id, tool)` is **not a unique operation key**
   for inner calls. Matching after hooks by input is also ambiguous when calls
   have identical inputs or settle out of order.
2. Use a retained executor wrapper for a unique operation ID held in that
   invocation's closure. Hooks remain useful for common preflight rejection and
   observation. Do not mutate inputs with undeclared tracking fields or replace
   OpenCode's call ID. [Proposed, based on S1–S3, S10]
3. Inner results are visible to their after hook even if the model's JavaScript
   omits them from `return`. The outer result's progress `toolCalls` records
   tool/input/status, not each structured result or a unique correlation ID.
   Its status can be `completed` even when Code Mode's output has `error: true`.
   Do not use outer success as proof every native operation succeeded. [S1, S2]
4. Internal Code Mode `tool.before`/`tool.after` progress callbacks are **not
   additional plugin hooks**. They are wired privately to progress reporting.
   `fetch` is a separate Code Mode extension using `globalThis.fetch`, not a
   registered tool. HTTP writes made that way do not become native tool-hook
   events. [S2 lines 154–189, 253–265; S16]

## 3. Binding a child before generation

There is **no public `session.create.before`, `child.created.before`, or
`step.initial` hook** in the reviewed V2 hook interface. `session.created` is a
public event, not an awaited plugin admission callback. Core creation publishes
it and returns the created session. An asynchronous subscriber cannot establish
a barrier before subsequent execution. The full public session-hook union is
in [S17]; creation is in [S8].

Two existing hooks provide narrower, useful boundaries:

| Boundary | What it can establish | Limit |
|---|---|---|
| `ctx.session.hook("prompt", …)` | Runs after Location plugins activate, before attachment/skill resolution and durable user-prompt admission; includes the actual child `sessionID` and message ID. Native subagent delegates through `sessions.prompt`. | Child record already exists. Runs once for admission, not every continuation. No typed rejection API; retries/concurrent admissions are not an exactly-once side-effect boundary. |
| `ctx.session.hook("context", …)` | Runs for each primary model request, including the first child request and tool continuations; has session/model/agent and editable system/messages/tool definitions. Can obtain the confirmed binding and add a compact work-context part before dispatch. | No typed rejection API or public cancellation result. Does not cover `title`, `compaction`, or transient `generate`; register their hooks separately when the guarantee includes them. |

These are documented boundaries and match pinned source. Native subagent creates
the child, publishes progress, submits its prompt, then starts/joins its job;
foreground after-tool observation is too late to bind its first turn, and even
background after-tool observation must not be assumed to precede generation.
New children inherit parent Location, metadata, and permission rules at creation;
reusing a child does not refresh those snapshots. [D2, S7 lines 153–234;
S8 lines 275–305; S18; S14 lines 229–258, 399–407; S19 lines 229–243]

**Fail-closed qualification:** the pinned Promise adapter awaits prompt/context
callbacks via `Effect.promise`; a rejection becomes a defect. The hook dispatcher
does not swallow it, and request preparation precedes provider dispatch. This
supports an abort-before-dispatch implementation, **not a documented typed
policy-denial UX**. Test failure recovery, visible errors, continuation, and
auxiliary requests before claiming that managed ticket generation fails closed.
Deleting tools alone does not prevent unbound text generation. [S4, S5 lines
592–596; S14 lines 246–258; S19 lines 229–243; D2]

For a strictly documented orchestration boundary, the app can create a session,
confirm its Rust binding and context mechanism, then submit its first prompt.
If reliable native-child prompt/context failure gating cannot be demonstrated,
disable native delegation in managed sessions or use explicit app-coordinated
workers; do not imply that an event listener closed the race. [Proposed]

**Version drift:** today's docs show `ctx.session.instructions.entry.*`, but
the pinned plugin `SessionDomain`, host, and Promise adapter do not expose that
member. The pinned experimental HTTP entry routes do exist. A bridge can use
validated HTTP entries or the documented `context` hook; it must not assume the
current website's plugin convenience method exists in v2.1.4. Entries are not
themselves an execution gate. [D2, D3, S17 lines 154–174; S5 lines 592–613;
S20 lines 547–590; S21 lines 586–644]

## 4. Worktree and move evidence

`worktree.updated` is ephemeral and carries **only `projectID` in its data**.
The event envelope's Location, where supplied, is not session/run attribution.
There is no caller session ID, operation ID, path, or success receipt in this
payload. Relisting after an event finds inventory changes, not which of two
concurrent bound sessions caused them. [S9 lines 55–71; S15 lines 130–143]

Native creation calls the selected strategy, canonicalizes its returned path,
records inventory and emits the update, **then** runs the project's startup
command. A tool error can follow successful creation. It also creates the
suggested parent directory before calling the strategy. Do not treat rejection
after native execution as absence of effects. [S15 lines 204–255]

Shell `git worktree add` and external CLI activity do not pass through native
`worktree_create`. OpenCode's saved `worktree.list` is not fresh discovery.
`worktree.refresh` asks strategies to enumerate known repository roots and
mutates saved inventory; Git's strategy delegates to Git worktree listing.
This discovers extant linked trees, not their ticket or creator. [D2, S15 lines
273–328; S22; S23]

For independent read-only reconciliation, Rust can use
`git -C <known-checkout> worktree list --porcelain -z` and verify each path's
repository/common directory and current branch/HEAD. The Git manual recommends
`-z` for robust paths. A separate clone or a tree created and removed between
polls need not appear in that known repository's inventory. Discovery must leave
origin/ownership **unknown** when it lacks stronger evidence. [D5; inference]

`session_move` returns `{sessionID, directory: input.directory}` after calling
move. That directory may be relative/unexpanded. Normally core validates the
destination, admits a move control and wakes execution; the runner later
publishes `session.moved` at its boundary. The event contains the resulting
Location/project/subpath, but no native tool-call/operation ID. A recovery path
can apply an idle move directly when its old Location is unavailable. [S6 lines
130–153; S24; S19 lines 81–113; S25 lines 82–90]

Therefore track **requested → admitted → applied/verified**, not simply
“moved.” Await a matching current session Location (and optionally the public
event), then validate Git/context. Even a matching event need not prove which
concurrent move request won. Serialize managed moves per target session and
surface externally superseded/ambiguous state rather than fabricating an ack.
Do not wait for a current-session move to apply from inside its own tool call:
application may need that call to finish first. [Proposed, based on S6, S19, S24]

## 5. Feasible tracking protocol for the proposal

The following is **proposed**, not an existing project-mgr contract. It works
when repository guidance causes a native tool call with no explicit model report.

1. **Establish a managed binding before prompting.** Rust records the selected
   service identity, exact session ID, binding generation, ticket/run, mode,
   approved scope revision, and verified Location. A compact OpenCode metadata
   annotation is a lookup hint, not authority. Navigation in the GUI cannot
   change it. Require the bridge at every permitted source/destination Location;
   `ctx.location` describes the plugin instance, not every target session. [D2]
2. **Wrap the existing native create/move executors.** Use effective-name
   transforms, preserve schemas/options, retain the native executor, and invoke
   it once. At invocation, allocate a unique operation ID and ask Rust to
   authorize and durably record intent **before** native execution. Rust resolves
   the caller binding and any distinct target session, checks approval/context,
   and serializes conflicting provisioning/move decisions. Failure to obtain the
   receipt rejects before calling native code. Hooks can reject unbound calls
   too, but do not pair concurrent inner calls solely by hook `id`. [S1–S6, S10]
3. **Record the native result, not a model claim.** The wrapper captures the real
   returned directory or admitted move target and sends a sanitized completion
   receipt to Rust with its closure-held operation ID. Rust validates Git/path
   facts and binds the resource to the run. Keep permission to clean up separate
   from “native operation observed.” Do not store outer JavaScript, prompts,
   subagent responses, or arbitrary raw errors in this journal. [S6, S15]
4. **Keep an uncertainty state.** Cancellation, startup failure, a lost response,
   crash, or unavailable Rust completion endpoint leaves an intent
   `needs-reconciliation`, not “nothing created.” Before another create for that
   provisioning slot, inspect actual inventory/Git and outstanding operations.
   Native creation has no application operation-ID/idempotency field. A journal
   prevents blind retry, not the need to resolve ambiguous candidates. Never
   auto-delete an unattributed tree to repair bookkeeping. [S9, S15]
5. **Bind native children at prompt admission; refresh at model dispatch.** A
   subagent before hook checks the parent's confirmed binding and, on reuse, the
   child's existing association. For a new child, its prompt hook reads its real
   `parentID`/inherited binding generation and asks Rust to idempotently establish
   a child binding before returning. The assigned task remains in OpenCode's
   admitted prompt; record only needed role/association metadata in Rust. A
   `context` hook reads the child's confirmed binding and current approved ticket
   revision, then injects orientation. Reuse must not silently rebind a child
   serving a different run. Missing, stale, or ambiguous bindings abort rather
   than defaulting to the GUI selection. This step requires the tested failure
   gate described above. [S7, S8, S17–S19]
6. **Reconcile continuously and on reconnect.** Events invalidate caches; reads
   establish current sessions, descendants, Locations and inventory. Confirm
   applied moves outside the originating tool call. Check Git independently on
   resume/resource actions and periodically when external work is supported.
   A discovered external tree can be shown/adopted without inventing attribution.
   Existing research records why historical event replay cannot be assumed.
   [S9, S15, S19, S22–S25; workflow research §§6–7]

This needs a reachable Rust authority while background managed work runs, not
merely a callback into an open GUI window. Plugin transport/authentication and
Rust journal persistence are design work still to specify. A worktree strategy
need not be replaced; the wrapper delegates to OpenCode's existing strategy.

## 6. Guarantee and limitation table

| Claim | Evidence / achievable guarantee | Required limit or gate |
|---|---|---|
| Observe native create/move without model reporting | Documented hooks/transforms; pinned Code Mode inner dispatch reaches them. | Install/activate the bridge in the actual execution Location and verify the installed version. |
| Reject before native effects | Before hook may fail with `Tool.Error`; wrapper may refuse to call retained executor. | Applies only to that intercepted invocation; does not undo earlier/parallel work. |
| Attribute a successful observed create | Caller identity plus wrapper-local operation ID plus native returned directory. | Validate against Rust binding/Git; return receipt can still be lost. |
| Unique Code Mode operation identity | Wrapper-local ID is feasible. | Native hook `id` is shared across inner calls; no public inner ID was found. |
| Observe every failure | After hook covers caught `Tool.Error`. | Not before rejection, every defect/interruption, crash, or lost callback. |
| Bind child before first primary turn | Prompt hook is awaited; context hook precedes each model dispatch. | No public before-create hook; test rejection/recovery; events alone cannot gate. |
| Prevent all unbound generation | Explicit create-bind-prompt; source supports aborting awaited request hooks. | No typed session-hook rejection; test all request kinds or restrict managed delegation. |
| Infer creator from `worktree.updated` | Project inventory invalidation only. | Cannot establish session/ticket/operation or distinguish concurrent creators. |
| Discover shell-created worktrees | Git enumeration / explicit OpenCode refresh. | Eventual inventory, not full historical provenance; refresh mutates OpenCode inventory. |
| Treat move success as completed context switch | Read current Location / observe applied event. | Native tool/API success alone is admission; result echoes input path. |
| Prevent duplicate provisioning after crash | Rust journal plus one pending provisioning decision and reconciliation. | No native exactly-once key; ambiguous partial success must block blind retry. |
| Enforce discussion-only through permissions | Deny relevant tools and validate native wrappers. | Permissions hook alone misses non-asserting tools; unrestricted shell/HTTP can bypass. |
| Enforce across every client/plugin/unload | Not established. | Tool hooks are not management-API middleware or an OS sandbox; missing/replaced bridge can fail open. |

**Capability gates before enabling managed native execution:**

- Prove direct and Code Mode interception, rejection before a fixture side
  effect, and structured result/error capture on the installed release.
- Prove repeated/concurrent inner calls receive distinct wrapper operation IDs;
  interruption and post-create startup failure recover without a second tree.
- Prove child prompt/context ordering and failure UX, including reuse,
  continuations, moves, auxiliary requests, and destination plugin activation.
- Prove reload/unload/later transforms cannot silently leave a managed session
  advertised as protected. Registry removal alone does not revoke old snapshots.
- Define bypass policy for external clients, other plugins, shell/processes and
  Code Mode HTTP. If these remain unrestricted, promise **observed native-tool
  tracking plus reconciliation**, not universal enforcement.
- If any required gate fails, disable that managed capability, use explicit
  app-coordinated operations/workers, or mark the session observation-only.
  Do not fall back to “the agent will report it.”

## Sources and validation limits

Only primary V2 documentation and first-party pinned source were used. Source
line ranges refer to `v2.1.4`, not this repository. Current documentation can be
newer than that tag. Existing research already established no meaningful local
OpenCode source/index; this task used read-only HTTP rather than building an
index. No installation, runtime/session mutation, provider request, or user-data
change was performed. Only this appendix was authored. No hidden provider
context or raw conversation content was requested. No executable acceptance
tests ran; the listed gates remain implementation prerequisites.

- **D1:** [Plugin overview](https://opencode.ai/v2/docs/build/plugins).
- **D2:** [Server plugin guide](https://opencode.ai/v2/docs/build/plugins/server),
  Tools, Hooks, Sessions, Permissions, Shell, Worktrees, and Context sections.
- **D3:** [Effect plugin guide](https://opencode.ai/v2/docs/build/plugins/effect),
  Tools and Hooks; explicitly documents before-hook `Tool.Error` rejection.
- **D4:** [Native tools](https://opencode.ai/v2/docs/tools), Automation sections.
- **D5:** [Official Git worktree manual](https://git-scm.com/docs/git-worktree),
  `list`, `--porcelain`, `-z`, Details, and Porcelain Format.
- **S1:** [Core tool dispatch](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool.ts#L103-L156),
  lines 103–156, 225–285: hooks, result/error handling, snapshots and inner dispatch.
- **S2:** [Code Mode adapter](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/codemode/tool.ts#L80-L189),
  lines 80–189, 234–265: shared context, outputs, progress, private runtime hooks.
- **S3:** [Public Effect tool hooks](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/effect/tool.ts#L20-L60),
  lines 20–60; [Promise types](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/tool.ts#L38-L72).
- **S4:** [Hook registry](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/plugin/hooks.ts#L13-L29),
  lines 13–29, 88–95: domains, permitted failures, sequential awaited dispatch.
- **S5:** [Promise adapter](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/adapter.ts#L478-L519),
  lines 478–519, 592–617, 634–656: executor wrapping and hook rejection semantics.
- **S6:** [Native OpenCode tools](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool/plugin/opencode.ts#L130-L218),
  lines 22–33, 130–218: schemas, effective namespace, create/move/removal execution.
- **S7:** [Native subagent](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool/plugin/subagent.ts#L100-L269),
  lines 29–54, 100–269: direct exposure, reuse, create/prompt/start/result ordering.
- **S8:** [Session creation](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session.ts#L275-L325),
  lines 275–325: creation event and inheritance.
- **S9:** [Worktree event schema](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/worktree.ts#L55-L71),
  lines 11–32, 55–71: create inputs/results and inventory invalidation.
- **S10:** [Tool transform wrapper/snapshot tests](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/test/tool-registry.test.ts#L91-L144),
  lines 91–144, 199–221, 1103–1185; read as source, not run here.
- **S12:** [Canonical tool runtime](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool/runtime.ts#L30-L68),
  lines 30–68 and final `effectiveName`: input/output validation and name encoding.
- **S13:** [Public shell hook type](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/effect/shell.ts).
- **S14:** [Model request preparation](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/model-request.ts#L229-L295),
  lines 229–295, 297–376, 399–407: context shaping and provider transport hooks.
- **S15:** [Worktree service](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/worktree.ts#L204-L255),
  lines 130–143, 204–255, 273–328: native effects, startup, inventory, discovery.
- **S16:** [Code Mode fetch extension](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/codemode/web.ts#L14-L43).
- **S17:** [Public session hooks/domain](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/effect/session.ts#L139-L174),
  lines 14–36, 139–174: exact supported hook union and context API members.
- **S18:** [Prompt preparation](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/prompt.ts#L29-L88),
  lines 29–88: activation and admission-hook ordering.
- **S19:** [Session runner](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/llm.ts#L81-L113),
  lines 69–113, 195–243: activation, move application, request preparation.
- **S20:** [Plugin host bridge](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/plugin/host.ts#L528-L590),
  lines 479–486, 528–590: direct client operations versus hook registration.
- **S21:** [Session HTTP protocol](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/session.ts#L586-L644),
  lines 321–332, 586–644: move acknowledgement and experimental instruction entries.
- **S22:** [Git worktree strategy](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/worktree/git.ts#L27-L37).
- **S23:** [Git worktree listing implementation](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/git.ts#L1280-L1291).
- **S24:** [Session move service](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/move.ts#L74-L158),
  lines 74–158: destination resolution, inbox admission, direct recovery.
- **S25:** [Session event schema](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/session-event.ts#L39-L90),
  lines 39–90: created and applied-move payloads.

[tag]: https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v2.1.4
