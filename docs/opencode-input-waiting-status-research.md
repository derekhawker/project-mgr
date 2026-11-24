# OpenCode input-waiting status: research

**Date:** 2026-11-13. **Scope:** evidence for the open decisions in the
“Investigate idle detection when OpenCode requests input” ticket. Read-only
research; no ticket or code changes. OpenCode’s current V2 API reference is an
experimental surface and may evolve.

## Recommendation

- Cover **both pending forms and permission requests**. Both block the agent
  pending a human decision, and V2 exposes session-scoped list endpoints for
  each.
- Keep **waiting for input**, **running**, **ready for review**, **reconnecting**,
  **unknown**, and **failed** distinct. Use “idle” only as a lower-level
  execution signal; do not label inactivity “ready for review.” Reserve ready
  for review for affirmative completion evidence (successful outcome plus
  session output/history).
- On answer, reject, or cancel, refresh the pending-input snapshot and classify
  again. A form/permission event is a prompt to reconcile, not sufficient
  evidence that the request remains pending or has cleared. If one of several
  requests remains, stay waiting; otherwise use execution/completion evidence.
- On reconnect, fetch the exact session’s pending forms and permissions, active
  state, session info/outcome, and enough history to establish output; reconcile
  from these snapshots plus durable session-log events. Treat volatile SSE as
  an update path, not a replay/recovery source. Missing/inactive alone means
  **unknown**, not completed.

## Evidence

### Current project integration

- `app/src-tauri/src/opencode.rs::Runtime::pending_inputs` fetches
  `/api/session/{id}/permission` and `/api/session/{id}/form`;
  `Runtime::reconcile_session` also reads `/api/session/active`, one history
  item, and `/api/experimental/session/{id}/log`. Its classifier gives pending
  inputs precedence over active/running and maps successful outcome plus
  history to `ReadyForReview`; its comment explicitly rejects inferring
  completion from inactivity (`classify_session_status`, lines 160–233).
- `SessionApplicationStatus` already includes `WaitingForInput`,
  `ReadyForReview`, `Reconnecting`, `Unknown`, and `Failed`. The tests
  `classifier_never_calls_inactive_session_complete` and
  `classifier_prioritizes_pending_input_and_failure` encode the essential
  distinctions (`app/src-tauri/src/opencode.rs`, lines 1648–1684).
- The **ticket-specific** older status projection remains weaker:
  `ticket_snapshot_status` in `app/src-tauri/src/lib.rs` returns `idle` whenever
  a session is absent from `/api/session/active` (lines 1740–1748), and the
  ticket SSE mapper only maps execution/status events (lines 1706–1737).
  Therefore do not use that legacy projection as proof of completion.
- Existing HTTP fixture tests assert the pending routes and that an active
  session can coexist with a pending permission/form
  (`app/src-tauri/src/opencode.rs::session_runtime_routes_preserve_ids_queries_auth_wrappers_and_cursors`,
  lines 2605–2699). Reconciliation tests assert an empty active map without
  completion evidence yields `Unknown` (lines 2540–2603).

### OpenCode V2 contracts and source

- The official [V2 API reference](https://opencode.ai/v2/docs/api) lists
  `GET /api/session/{sessionID}/form` (pending session forms),
  `GET /api/session/{sessionID}/permission` (pending session permissions),
  `GET /api/session/active`, `GET /api/session/{sessionID}`, and
  `GET /api/experimental/session/{sessionID}/log`. Form routes also provide
  reply and cancellation; permission routes provide reply. The schema for
  `Session.Info` has optional `outcome` values `succeeded`, `failed`, or
  `interrupted`; this is separate from active status.
- Pinned first-party source matching the project’s installed v2.1.4 is
  [OpenCode v2.1.4 `session/status.ts`](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/opencode/src/session/status.ts):
  `SessionStatus.Info` is `idle | retry | busy`; `get` defaults to idle, while
  `set(idle)` removes the in-memory active entry and publishes `session.status`
  and deprecated `session.idle`. This is execution state, not a completion
  outcome. Source:
  [`session.ts`](https://github.com/anomalyco/opencode/blob/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824/packages/opencode/src/server/routes/session.ts)
  exposes the status list and session info routes.
- Current first-party route source at commit `ec3ae17e` puts the
  session-scoped form and permission list routes in
  [`session.ts`](https://github.com/anomalyco/opencode/blob/ec3ae17e/packages/opencode/src/server/routes/session.ts);
  global question/permission listing and replies are in
  [`question.ts`](https://github.com/anomalyco/opencode/blob/ec3ae17e/packages/opencode/src/server/routes/question.ts)
  and [`permission.ts`](https://github.com/anomalyco/opencode/blob/ec3ae17e/packages/opencode/src/server/routes/permission.ts).
  Form routes support reply and delete/cancel. This is newer route organization
  than the pinned v2.1.4 status source; the current API reference supports this
  newer route contract. Re-fetch the session-scoped pending lists after a
  response/cancellation: the response itself is not the durable session outcome.
- The [V2 API reference](https://opencode.ai/v2/docs/api) includes `form.created`,
  `form.replied`, `form.cancelled`, `permission.asked`, and `permission.replied`
  in `GET /api/event`, alongside `session.execution.started/succeeded/failed/interrupted`
  and `session.status`/`session.idle`. These event names support prompt,
  reconcile, and clear/update transitions. The same reference describes
  `/api/event` as volatile; its first-party implementation
  [`event.ts`](https://github.com/anomalyco/opencode/blob/ec3ae17e/packages/opencode/src/server/routes/event.ts)
  subscribes live to the bus and does not replay missed events.
- Durable session log is a better reconnect supplement than global SSE, but
  pending request state should still come from the pending-list endpoints.
  The project’s own reconciliation already combines both, rather than assuming
  the log alone stores a currently pending form/permission.

## Uncertainty and boundaries

- The official API calls this surface experimental. Route presence and event
  names are documented, but the public reference does not promise a transaction
  spanning pending-list snapshots, active state, history, and log; requests can
  change between calls. Reconcile again on relevant events and tolerate a
  transient inconsistent snapshot.
- `session.status`’s `idle` is an in-memory execution status default, not
  proof of a successful turn. `Session.Info.outcome` is the explicit terminal
  outcome. Whether product language should call successful completion “ready
  for review” is a UX choice; the evidence supports keeping it distinct from
  idle and from ticket workflow status.
- V2 supports form and permission requests. “Question” here should be scoped to
  the V2 form mechanism rather than assuming a separate V1 question-request
  endpoint is part of this integration.

## Sources

- [OpenCode V2 API reference](https://opencode.ai/v2/docs/api) (routes, schemas,
  events; accessed 2026-11-13).
- [OpenCode V2 permissions guide](https://opencode.ai/v2/docs/permissions)
  (`ask` waits for a client decision).
- OpenCode source tag [`v2.1.4`](https://github.com/anomalyco/opencode/tree/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824),
  commit `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`; source links above pin
  status, session, form, permission, and SSE route implementations.
- Project evidence: `app/src-tauri/src/opencode.rs` and
  `app/src-tauri/src/lib.rs` references listed above.
