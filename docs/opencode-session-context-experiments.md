# OpenCode child, context, skill, and reload experiments

**Date:** 2026-11-07. **Runtime:** installed `opencode v2.1.4`,
`/home/derekhawker/.opencode/bin/opencode`. **Source pin:** `v2.1.4`, commit
`68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`. This is feasibility research, not an
installed integration or an amendment to the accepted product contract.

## Outcome

**Native delegation can establish a verified child assignment and attach its
entry skill before its first primary provider request on this release.** Awaited
prompt/context hooks rejected bad handoffs and unavailable binding lookups before
dispatch; the same native child recovered after a context failure. Context
refreshed on a real tool continuation, and a session retained its binding while
moving into another scratch checkout and then a Git-free notes directory.

**A removable plugin is not an unconditional fail-closed host boundary.** After
removing the plugin and explicitly reloading the isolated server, an already
bound session generated despite the authority's deny flag. Plugin inventory
exposed its absence; OpenCode did not automatically stop that session. Resolving
that release constraint is necessary, not an optional later enhancement if the
product promises managed protection through reload/unload.

The final fixture passed **29/29 assertions**, twice from clean isolated state.
Each run made **28 local fake-provider requests**: 26 identified primary,
1 identified transient generate, and 1 primary after plugin removal with no
plugin identity header. No external model provider or real credentials were
used. Assertions demonstrate the installed OpenCode seams, **not** a production
Rust binding store, durable assignment transactions, adversarial isolation,
native terminal rendering, or model compliance with instructions.

## Evidence and isolation

Read before experimenting: repository `AGENTS.md`,
[tool-observation research](opencode-tool-observation-research.md),
[workflow-integration research](opencode-workflow-integration-research.md), and
[ticket/session proposal](ticket-session-protocol-proposal.md). Official V2
documentation and pinned first-party implementation are cited below. Website
documentation can be newer than the installed release.

The throwaway harness and all intentionally authored scratch artifacts are under:

```text
/tmp/opencode/opencode-context-experiment-20261107/
  run.py                     # Python standard library; owns server lifecycle
  plugin/index.js            # throwaway Promise plugin; retains native executor
  source-*                   # downloaded v2.1.4 implementation files
  run-s8cw7x0v/              # final full run
  run-ev994d2w/              # independent verification rerun
  verification-rerun.log
```

One rerun command, while these deliberately temporary artifacts remain:

```sh
python3 /tmp/opencode/opencode-context-experiment-20261107/run.py
```

The command makes a fresh `run-*` directory. It is not a repository test command,
and the scratch artifacts are not a durable packaged test suite. Final script
SHA-256 values:

```text
run.py          9556b010325480a29cb1a763d5f9a2d77c1209bdb063a194397817c9d7113d47
plugin/index.js 6b32040ed7ea15f05fc3b9c1c11ca8efa6e8b713bb7606a8cd569ba71c358317
```

Each final run used:

- A new `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`,
  `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`, `OPENCODE_CONFIG_DIR`, and `TMPDIR`, all
  beneath that run directory. Final `/api/info` confirmed its temporary path was
  `<run>/tmp/opencode`.
- An allowlisted subprocess environment: no inherited provider credentials,
  sessions, user configuration, or service discovery configuration. A synthetic
  private-server password was set explicitly; no real password was copied.
- The installed binary invoked as
  `opencode serve --hostname 127.0.0.1 --port <ephemeral-port>`, **not** a default
  background service, `opencode api`, or `service restart`. Authenticated HTTP
  calls targeted that exact private server. The launch directory was scratch
  `notes/`, not this repository.
- A Python `ThreadingHTTPServer` on a separately assigned loopback port. Its
  authority endpoints accepted synthetic binding/assignment operations; its
  `/v1/chat/completions` endpoint returned deterministic SSE text or tool calls.
  OpenCode's actual compatible-provider adapter encoded the requests and its
  actual tool runtime executed the scripted calls.
- A scratch global config with only the fixture provider allowed by provider-use
  policy, model fetching disabled, updates disabled, and snapshots disabled.
  Two scratch Git directories contained only synthetic `AGENTS.md` guidance;
  `notes/` had guidance but no `.git`. No production checkout was moved.
- A plugin listed in that **isolated global config**, plus one synthetic skill
  from an explicit scratch skill source. Nothing was installed in the user's
  real global plugin or skill directories.
- HTTP deadlines of 5 seconds for plugin callbacks, 10 seconds for provider
  requests, 15 seconds for ordinary harness calls, 25 seconds for session waits,
  and 35 seconds for startup. Owned server processes ran in their own process
  group; `finally` sent termination, waited up to 8 seconds, and provided a
  kill-and-wait fallback. The local HTTP server was shut down and joined too.

The fixture authority kept **structured IDs, generations, roles, claims, and
revisions**, not task prompts. Admission inspected the synthetic prompt in memory
to extract its assignment reference. Fake-provider evidence files do contain
synthetic provider bodies/tool scripts so their actual delivery could be checked;
these are not an application prompt journal or examples of permitted production
logging. This report retains only small sanitized facts. No live app, GUI,
database, credentials, service, or user conversation was inspected or changed.

### What was real, and what was substituted

| Real installed execution | Deliberate fixture substitution |
|---|---|
| CLI/private HTTP server, session records, prompt admission, skill resolution, context assembly, provider encoding, `subagent`, `execute`, session move, compaction, generate, plugin activation/unload/reload | Deterministic local provider instead of an external model; in-memory Python authority instead of future Rust persistence; synthetic GUI-selection variable |

The authority's lock proves this fixture can serialize competing real admission
callbacks. It does **not** prove a future Rust store is atomic, crash-safe, or
correct. The fake provider scripts delegation; it does not prove a real model
will discover a workflow, obey a skill, or choose the right assignment.

## H1 — Bind before the native child's first primary request

**Hypothesis.** Documented prompt/context boundaries can establish actual child
identity, role, and assignment before generation, and withhold generation when
binding cannot be established. Parentage/inherited metadata are only hints.

**Experiment.** The provider instructed the real owner session to call the
direct native `subagent` tool (`agent: "general"`, foreground). A public tool
transform retained its existing executor. The wrapper obtained a dispatch
reference and appended it to the existing `prompt` field. It did not replace
native creation, invent an extra native argument, call a fabricated Code Mode
subagent API, or bind from an after-tool notification.

The real child's prompt hook fetched its actual session record, then awaited
authority admission. The context hook independently fetched the resulting
binding and appended a compact system part. A `model.request` hook added
synthetic session/kind headers, letting the HTTP fixture attribute **received
provider requests**, rather than treating a hook invocation as proof of dispatch.

**Observations.** Final cases 2–4, 8, 12–15, and 20:

```text
new native child: prompt -> bind(worker, assignment-1) -> context -> provider
first child provider requests: 1
native missing reference: child records 1; child provider requests 0
native mismatched reference: child records 1; child provider requests 0
native first-context authority error: child provider requests 0
repair authority + native reuse of that exact child: child provider requests 1
```

- For both malformed native handoffs, the retained native executor really created
  and tried to prompt a child. Fault injection changed only the wrapper's
  reference output. The child admission hook rejected it; the parent received a
  tool error containing the fixed assignment-error category. The idle child
  record remained; the experiment did not delete it to hide partial setup.
- All sessions carried synthetic `metadata.ticketHint = "NOT_AUTHORITY"`.
  A separately created child inherited that metadata and the genuine owner
  `parentID`, but its reference-free prompt returned **HTTP 500 with an empty
  body**, and it made **0 provider requests**. Its inherited hint could not
  establish a binding.
- With a valid claim but a rejected first context lookup, the native parent saw
  `BINDING_AUTHORITY_UNAVAILABLE`. Removing that injected denial and calling the
  native tool with the same child ID successfully continued the child. This
  demonstrates runtime rejection **and recovery**, not merely source ordering.
- The explicit fallback was also exercised: create an exact independent session
  in repo-free `notes/`, bind it as `worker` with an explicit assignment, then
  prompt. It received local notes guidance and ticket/worker context in **1**
  provider request without native-child correlation.

**Verdict: supported on installed v2.1.4 for the tested foreground path.** The
child exists before admission, so this is a before-generation gate, not a
before-create transaction. No claim is made for every provider, background
delegation, cancellation interleaving, or process-crash recovery. The empty 500
is a real UX limitation: hooks have no documented typed policy-denial result.
Native wrapping improved visibility to the parent in these tests; direct callers
still need a sanitized bridge error/readiness and retry path. [D1, S1–S5]

If a supported release fails this ordering/correlation test, the highest-confidence
fallback is explicit **create → bind exact session → validate context/entry skill
→ prompt**, not an asynchronous `session.created` subscriber. That fallback was
tested here; it does not repair missing-plugin protection, and must not silently
replace a release requirement to preserve native delegation.

## H2 — Versioned assignment reference and exact-child claim

**Hypothesis.** A retained native executor wrapper can correlate a unique child
at admission without the application storing task prompts, including reuse and
stale/conflicting handoffs.

**Experiment.** The synthetic nonsecret suffix used the existing native text
field:

```text
<assignment-ref-v1>{"version":1,"dispatch":"dispatch-N",
"assignment":"assignment-N","parentGeneration":1}</assignment-ref-v1>
```

The authority checked the complete reference against a separately registered
pending dispatch, its runtime parent, current parent binding generation, and the
actual admitting child ID. Its claim operation allowed only an unclaimed dispatch
or its already bound exact child. Reuse checked assignment/ticket/generation
before calling the original native executor; admission also refused conflicting
existing bindings. The string was a **lookup reference, not a bearer credential**.

**Observations.** Final cases 5–13:

| Scenario | Actual result |
|---|---|
| Initial native dispatch | Exact child bound as worker; first request contained `role=worker assignment=assignment-1`; owner request contained `role=owner`. |
| Valid native reuse | Same child; cumulative provider count **2**; no second conversation for that assignment. |
| Mismatched-assignment native reuse | Wrapper rejected before native prompt; **0 additional child provider requests**; parent history contained `REUSE_MISMATCH`. |
| Genuine reference replayed to another child | HTTP **500**, **0 provider requests**; authority category `DISPATCH_ALREADY_CLAIMED`. |
| Issued reference after parent generation advanced | HTTP **500**, **0 provider requests**; category `ASSIGNMENT_REFERENCE_MISMATCH`. |
| Two concurrent real prompt admissions for one unclaimed dispatch | HTTP statuses **[200, 500]**; provider counts **[1, 0]**; only the winning exact child bound. |
| Missing/fabricated reference through real native executor | Two retained child records, **0 provider requests each**, no binding for either. |

Across the final run there were **8 dispatch records**: 6 from permitted retained
native executor invocations and 2 issued directly by the fixture for stale/racing
admission experiments. There were **7 model-requested native subagent calls**;
the seventh, mismatched reuse, stopped at wrapper preflight without another
dispatch. These are not unique operation IDs inferred from parentage or the
native call ID. Five admission `bind` observations include repeated binding
confirmation for valid reuse; they are not five newly created native children.

**Verdict: supported correlation seam, not production transaction acceptance.**
Native creation/reuse and competing admissions were real; the authoritative
reservation/claim policy was a small fixture. It did not test durable restart,
lost acknowledgements, same-message-ID concurrent admission, one-unconsumed-
reservation enforcement, or all assignment transitions. Production Rust must
own those invariants, immutable assignment-to-ticket/run linkage, idempotent
exact-child claims, and explicit reconciliation on parent rebind. Do not copy
the fixture as a second JavaScript/Python product database. Role-specific
**context** was tested; owner-only mutation enforcement was not. [D1, S1–S3]

## H3 — Fresh context, continuation, failure, and resume

**Hypothesis.** `ctx.session.hook("context", …)` can refresh the current binding
before each primary request, including tool continuation/resume; GUI selection
cannot implicitly rebind it; errors stop dispatch and remain recoverable.

**Experiment and observations.** Final cases 16–19, 24–25:

1. Set synthetic GUI selection to `TICKET-B`, leaving the authority's exact owner
   binding on `TICKET-A`. The provider requested the real `execute` tool with a
   harmless literal-return script. After receiving the first request, the fake
   provider advanced authoritative record revision from **2 to 4** before sending
   that scripted tool call. The actual tool continuation made the second request.
   Its injected context changed from **revision=2** to **revision=4**, remained
   **ticket=TICKET-A**, and never selected `TICKET-B`. There were exactly **2**
   primary provider requests, not just two manually invoked context callbacks.
2. Reject the next actual context lookup with a fixed authority error. Prompt
   admission returned **200**, completion wait returned **204**, and the provider
   count changed by **0**. Public `/api/session/{id}/context` contained an actual
   assistant-message error:

   ```json
   {"type":"unknown","message":"BINDING_AUTHORITY_UNAVAILABLE"}
   ```

   The session record's top-level `error` was not populated. A successful
   admission or wait status therefore does **not** mean the turn succeeded.
3. Remove the denial and send another prompt to that same owner. It made exactly
   **1** provider request with the freshly selected revision **3**. The separate
   native-child first-context failure/reuse experiment in H1 also recovered.
4. Request real session compaction. The dedicated compaction hook supplied a
   synthetic result: **0 context-hook calls and 0 provider requests** for that
   operation. This proves hook separation, not model-based compaction coverage.
5. Request real transient session generation. Its dedicated generate hook ran;
   HTTP returned **200**, with **1** provider request tagged `generate`, **0**
   context-hook calls, and **no injected `TICKET_CONTEXT`** in its request.

**Verdict: supported for primary requests while the plugin remains active.**
The history error and parent tool error are publicly observable/recoverable;
their native TUI/Wayland presentation was not inspected. The binding is read by
exact session, not from mutable GUI navigation. Context injection is an outgoing
request edit, not a second persisted conversation or a global rebind. This
experiment changed record revisions and parent generation; it did not validate
an authorized transfer to another real ticket or stale mutation prevention.
The GUI variable was deliberately synthetic and unused by binding lookup; this
checks the prototype's separation, not the production Tauri selection code.

The context hook **does not cover all model traffic**. Title uses its own hook;
the fixture registered a fixed-title result to suppress possible auxiliary
traffic, but did not force/acceptance-test automatic title generation. Compaction
and transient generate need their own refresh/denial policy if included in a
managed guarantee. In particular the generate result above is a tested boundary,
not evidence of protected auxiliary generation. Generic one-shot generation is
another API surface; it was not exercised. [D1, S2, S4–S5]

## H4 — Global availability, move, missing plugin, and stale snapshots

**Hypothesis.** A globally available but bound-session-scoped bridge can survive
location changes, refresh local policy, and retain ticket identity; public APIs
may or may not suffice to prevent reload/unload failures.

**Move experiment.** Final cases 20–23 and 26–29:

- The owner started in scratch `repo-a/` with `LOCAL_ALPHA` guidance. A real move
  request to `repo-b/` returned **204**. After waiting and prompting, session
  readback showed `repo-b/`; the received provider payload included the actual
  instruction update saying `repo-a/AGENTS.md` **no longer applies** and introducing
  `repo-b/AGENTS.md` with `LOCAL_BETA`.
- A second real move to Git-free `notes/` also returned **204**. Readback and the
  subsequent provider payload showed the destination and `LOCAL_NOTES` guidance.
  Both post-move primary requests still contained `ticket=TICKET-A`.
- Plugin setup was observed once in each of **3 Locations**: `repo-a`, `repo-b`,
  and `notes`. The notes instance had already activated for the explicit fallback
  worker; it remained available to the moved owner. Global configuration meant
  availability across these Locations, not one shared Location closure.
- An unrelated unbound session in that same notes Location made **1** request
  without `TICKET_CONTEXT` or the synthetic entry skill body. Ticket context and
  skill attachment were conditional on verified binding. Auxiliary suppression
  was fixture infrastructure, not a complete production unrelated-session policy.

**Unload experiment.** Read `/api/plugin` for the exact notes Location and saw
`context-experiment`. Set the owner authority to deny, remove the plugin entry
from the **isolated** global config, and call the private server's real
`POST /api/location/reload`. The subsequent plugin inventory omitted the plugin;
three cleanup/unload observations were recorded. Prompt that same owner again:

```text
authority state: deny owner
plugin inventory: bridge absent
provider requests after prompt: +1
plugin session/kind headers: absent
TICKET_CONTEXT in outgoing request: absent
```

This is a **reproduced fail-open**, not a theoretical concern or a failed test
hidden among successes. Its assertion passed because it expected to expose that
limitation. The now-uninstrumented provider request was still the sole primary
turn initiated by this isolated owner prompt; it was not an external model call.

**Stale snapshot/later-transform analysis.** Official documentation explicitly
states that model requests capture executable tool snapshots; transforms,
disposal, and reload affect future snapshots, not already captured executors.
Later valid tool registrations can replace earlier ones, and later hooks can
edit earlier context. The pinned registry/adapter implementation supports those
limits. Keeping live authority checks inside a retained executor avoids stale
*authority values* for that wrapper; it does not force a replacement executor to
call it, revoke old snapshots, or require a missing context hook to run. [D1,
S3, S6–S8]

`plugin.list` detects plugin presence/absence and `tool.list` permits effective
registry inspection. Neither is a documented atomic dispatch lease requiring
managed binding validation. Checking inventory then prompting has a check/use
gap. An observer can mark missing capability unhealthy and refuse **its own**
new dispatches; that is not proof it can synchronously stop every native
continuation after unload. The full in-flight config-watch/reload race and an
actual malicious/later transform replacing the wrapper were **not** reproduced;
their snapshot/order risks remain documented and source-supported, not runtime
acceptance claims.

**Verdict:** location availability/local-instruction refresh/binding persistence
and repo-free notes are **supported in the tested runtime**. Unconditional
protection when the plugin disappears is **refuted**. Detection is feasible;
automatic prevention by the removable bridge alone is not established.

## SKILL — Explicit entry, not catalog discovery

The scratch `context-entry/SKILL.md` had a small body containing
`ENTRY_SKILL_BODY_SENTINEL`. The admission hook appended
`{ id: "context-entry" }` to `event.prompt.skills` **only after binding succeeded**.
OpenCode's actual prompt/skill resolver returned an admitted user payload with:

```text
payload.skills[0].id = context-entry
payload.skills[0].name = Synthetic Entry
payload.skills[0].text contains the rendered body and scratch base directory
```

The first owner and successfully admitted native-child provider requests
contained that rendered body. This is explicit attachment evidence, stronger
than an advertised ID/name/description catalog. It is **not** a claim that the
fake model independently invoked the `skill` tool, read additional references,
or obeyed the procedure. Entry is attached again on managed prompts in this
fixture; choosing production re-entry triggers/history deduplication remains
design work. [D1–D2, S1]

The current website documents `ctx.session.instructions.entry.*`, but all
**3 actual plugin activations** reported
`typeof ctx.session.instructions === "undefined"`. Pinned Promise/Effect session
domains and the adapter omit that member too. This is both runtime and source
evidence of version drift. The fixture therefore used documented context hooks,
not a guessed plugin convenience method. Experimental HTTP instruction-entry
routes exist in the installed OpenAPI/pinned protocol, but were **not exercised**
and are not an execution gate. [D1, S2–S3, S9]

## Verification ledger

Every server that started was terminated and waited. Its observed exit code was
**130** after the runner's termination signal; this is the shutdown result, not
a failed scenario. No kill fallback was needed.

| Scratch run | Harness exit | Assertions passed/run | Local provider requests | Meaning |
|---|---:|---:|---:|---|
| Initial Python parse attempt | 1 | 0/0 | 0 | Fixed an unclosed fixture dictionary; no server started. |
| `run-_541465e` | 1 | 0/0 | 0 | Startup probe lacked private-server authentication; server was listening, then was cleaned up. |
| `run-norevp8k` | 0 | 0/0 | 1 | Initial manual smoke output; not the full assertion suite. |
| `run-wqt04jpz` | 1 | 7/8 | 9 | Incorrect expectation that prompt-hook error text appeared in HTTP response; actual response was empty 500. Preserved this as a finding. |
| `run-3renpxqu` | 0 | 21/21 | 17 | Initial expanded suite. |
| `run-2dx4q3vz` | 0 | 26/26 | 22 | Added malformed native handoffs and unload. |
| `run-2755qtcs` | 0 | 28/28 | 27 | Added native first-context failure/recovery and isolated `TMPDIR`. |
| `run-s8cw7x0v` | 0 | **29/29** | **28** | Final suite, including actual auxiliary generate. |
| `run-ev994d2w` | 0 | **29/29** | **28** | Same final scripts, clean-state verification rerun. |

Earlier bootstrap servers advertised the CLI's default `/tmp/opencode` temporary
base; final runs explicitly confined it under their own run directory. All
harness-created sources, configs, repositories, evidence, and logs stayed under
the experiment root. No project test suite ran: no application behavior changed.

Final rerun evidence is in `run-ev994d2w/evidence.json`, `context-error.json`,
`openapi.json`, and `server.log`. Its trace recorded **28 context lookups**,
**28 received provider requests**, **26 prompt observations**, **8 dispatches**,
**5 binding confirmations**, **3 activations**, **3 unloads**, **1 compaction**,
and **1 generate**. There were **9 authority rejections**: 2 missing-reference,
2 already-claimed, 2 mismatched-reference, 2 unavailable-authority, and 1 reuse
mismatch. Provider count alone is not a success metric; zero-dispatch denials
and the one intentional unguarded request are the critical observations.

## Accepted conclusions and full-release decisions

**Independent main-investigator verification:** after inspecting the driver,
the main investigator reran it against fresh isolated state. Result: **exit 0,
29/29 assertions, 28 local provider requests**, server stopped with exit 130.
Evidence: `/tmp/opencode/opencode-context-experiment-20261107/run-hmzj_57u/evidence.json`.
The native-child gate successes and intentional plugin-removal fail-open both
reproduced. Fixture source was captured in its own temporary Git repository,
branch `throwaway-session-context`, commit `324b0f4`, without a main-project
commit or push. These scratch artifacts remain temporary, not a durable archive.
The source commit has since been imported into the main repository as a local
research branch; see the
[fixture inventory](idea-first-implementation-readiness.md#preserved-executable-fixtures).

1. **Keep native delegation as the intended path.** The required first-turn seam
   works here; an untested assertion that OpenCode cannot bind native children
   is no longer justified. Preserve its native conversation/history and exact-ID
   reuse. Ship a version/capability acceptance test, not assumptions from current
   website types or after-tool events.
2. **Put durable authority in Rust.** Persist assignment/binding/operation facts,
   not copies of owner/worker prompts. Require exact-child claims and live checks
   on every managed mutation; different injected role text alone is not write
   enforcement. Persistence/restart correctness remains outside this experiment.
3. **Resolve the unload guarantee before calling the release fully managed.** A
   trusted, version-pinned app-owned runtime/configuration boundary is a possible
   deployment constraint, but then document that trust and continuously expose
   health; do not promise protection against its removal. If protection must
   survive plugin removal/replacement and arbitrary external prompts, require a
   non-removable host dispatch/binding guard or equivalent independently enforced
   capability. No atomic mandatory-plugin guard was established in the reviewed
   public API. An availability badge or polling is not that guarantee.
4. **Keep recovery in the same low-friction conversation.** Context failure can
   surface in public history and recover on the same owner/child. Provide a named
   blocked/readiness state and repair/retry path for empty admission 500s; do not
   delete failed child records, change GUI selection, or blindly spawn duplicates.
   Terminal/GUI rendering and human-facing recovery still need acceptance.
5. **Support notes workspaces without Git.** An explicit scratch notes root
   accepted a bound worker and a moved owner, local guidance, and ticket context.
   Git/worktree provisioning need not be a ticket discussion prerequisite.
6. **Specify auxiliary policy and stale-context behavior.** Context covers
   primary requests only; actual generate bypassed that injection. Add separate
   policies where required. A later transform, removed hook, or already captured
   executor cannot be treated as protected just because setup once succeeded.
7. **Do not defer required core behavior under a smaller-release label.** Native
   child assignment, entry attachment, role authority, context refresh, visible
   errors/recovery, location health, and notes support are core release concerns.
   Explicit dispatch is the tested contingency when native capability fails,
   not evidence that native delegation was delivered. Multi-repository
   orchestration is excluded from this research and need not block these seams.

Documentation review: this appendix qualifies the earlier source-only research
and the proposed protocol's capability gates. Those documents were not edited
because this task owns only this file. No product UX, command contract, test
matrix, production skill, or accepted workflow changed.

## Primary sources

- **D1:** [Official V2 server plugin guide](https://opencode.ai/v2/docs/build/plugins/server):
  prompt/context hooks, separate request kinds, transforms/snapshots, plugin
  inventory, lifecycle, and current instruction-entry convenience API. Also
  [plugin overview](https://opencode.ai/v2/docs/build/plugins).
- **D2:** [Official V2 skills](https://opencode.ai/v2/docs/skills): discovery catalog
  versus body loading; explicit selection. Prompt attachment mechanics are
  additionally pinned in S1.
- **D3:** [Official V2 config](https://opencode.ai/v2/docs/config),
  [providers](https://opencode.ai/v2/docs/providers), and
  [API](https://opencode.ai/v2/docs/api): global configuration, local compatible
  provider configuration, experimental HTTP surface. Actual final calls used
  the private installed server's `/openapi.json`, not guessed website shapes.
- **S1:** [Prompt preparation, v2.1.4](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/prompt.ts#L29-L88):
  awaits activation and prompt hook, then resolves selected skills and constructs
  admitted payload.
- **S2:** [Public Promise session types](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/session.ts#L139-L174)
  and [Effect session domain](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/effect/session.ts#L139-L174):
  exact hook union and no instruction-entry convenience member.
- **S3:** [Promise adapter](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/adapter.ts#L478-L519),
  especially lines 478–519, 592–613, 621–622, 647–656: executor retention/adaptation,
  awaited Promise hooks, exposed session members, and unload cleanup.
- **S4:** [Native subagent](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool/plugin/subagent.ts#L153-L255):
  actual child creation/reuse, prompt-before-job ordering, and failure with child ID.
- **S5:** [Model request preparation](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/model-request.ts#L229-L295)
  and lines 399–407: request hook before dispatch, separate primary/auxiliary hooks.
- **S6:** [Hook dispatcher](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/plugin/hooks.ts#L13-L29),
  also lines 88–95: sequential awaited dispatch, rather than swallowed policy errors.
- **S7:** [Executable tool snapshots](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/tool.ts#L225-L285)
  and [pinned registry/snapshot tests](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/test/tool-registry.test.ts#L1103-L1185).
  Tests cited as source were not run here.
- **S8:** [Plugin host](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/plugin/host.ts#L528-L590):
  session bridge/hook registration. No current convenience API inferred into the pin.
- **S9:** [Pinned session HTTP protocol](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/session.ts#L586-L644):
  experimental instruction-entry routes. Creation/prompt/move routes are in the
  same file; [CLI private server launch](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/cli/src/server-process.ts#L68-L144)
  establishes explicit host/port, password, and isolated configuration options.

Move and instruction-state implementation details are traced in the existing
[workflow integration appendix](opencode-workflow-integration-research.md#3-what-a-session-move-refreshesand-what-it-preserves).
The runtime move evidence above is new; it does not establish native Wayland or
interactive-terminal acceptance.
