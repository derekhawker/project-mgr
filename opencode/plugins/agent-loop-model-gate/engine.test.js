import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import test from "node:test";
import { configuredSessionAllowlist, createModelGate, wakeEventTypes } from "./engine.js";

const sessionID = "ses_ticket";
const ticket = "/workspace/tickets/fixture.md";
const todo = "/workspace/tickets/fixture.todo";
const binding = {
  ok: true,
  ticket,
  todo,
  signature: "binding-v1",
  ticketContent: "# Fixture ticket",
  todoContent: "# TODO\n- [ ] Continue scoped work",
};
const boundary = (idleID = "idle-1") => ({
  ok: true,
  idleID,
  lastMessage: "The current approved task is complete.",
});
const event = (type = "session.idle", id = sessionID) => ({
  type,
  properties: { sessionID: id },
});
const answer = (decision = "continue", reason = "A scoped task remains.", task = "Continue scoped work") =>
  JSON.stringify({ decision, task: decision === "continue" ? task : null, reason });

test("configured session allowlist fails closed and deduplicates exact IDs", () => {
  for (const options of [
    undefined,
    {},
    { allowedSessionIDs: [] },
    { allowedSessionIDs: null },
    { allowedSessionIDs: "ses_ticket" },
    { allowedSessionIDs: [""] },
    { allowedSessionIDs: ["   "] },
    { allowedSessionIDs: [sessionID, 42] },
  ]) {
    assert.deepEqual(configuredSessionAllowlist(options), []);
  }

  assert.deepEqual(
    configuredSessionAllowlist({ allowedSessionIDs: [sessionID, sessionID] }),
    [sessionID],
  );
});

function fixture(options = {}) {
  const calls = [];
  const values = new Map(options.initialStorage ?? []);
  const storage = {
    get: async (key) => structuredClone(values.get(key)),
    set: async (key, value) => values.set(key, structuredClone(value)),
  };
  const api = {
    binding: async (id) => {
      calls.push(["binding", id]);
      return options.binding ? options.binding(id, calls) : binding;
    },
    hardCheck: async (id, found) => {
      calls.push(["hardCheck", id, found]);
      return options.hardCheck ? options.hardCheck(id, found, calls) : boundary();
    },
    decide: async (input) => {
      calls.push(["decide", input]);
      return options.decide ? options.decide(input, calls) : answer();
    },
    prompt: async (input) => {
      calls.push(["prompt", input]);
      return options.prompt?.(input, calls);
    },
    sessions: async () => {
      calls.push(["sessions"]);
      return options.sessions ? options.sessions() : [sessionID];
    },
    ...(options.diagnose && {
      diagnose: async (id) => {
        calls.push(["diagnose", id]);
        return options.diagnose(id, calls);
      },
    }),
  };
  return {
    calls,
    storage,
    values,
    gate: createModelGate({
      api,
      storage,
      allowedSessionIDs: [sessionID],
      ...options.gateOptions,
    }),
    count: (name) => calls.filter(([call]) => call === name).length,
  };
}

test("invalid or unbound sessions are ignored before hard checks and model decisions", async () => {
  for (const unavailable of [undefined, { ok: false, reason: "session-not-eligible" }]) {
    const f = fixture({ binding: () => unavailable });
    const result = await f.gate.event(event());
    assert.equal(result.state, "ignored");
    assert.equal(f.count("hardCheck"), 0);
    assert.equal(f.count("decide"), 0);
    assert.equal(f.count("prompt"), 0);
  }

});

test("deterministic hard checks run before the model and veto it on failure", async () => {
  const f = fixture({ hardCheck: () => ({ ok: false, reason: "pending-input" }) });
  const result = await f.gate.event(event());
  assert.deepEqual(result, { state: "paused", reason: "pending-input" });
  assert.deepEqual(f.calls.map(([name]) => name), ["binding", "hardCheck"]);
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
});

test("allowlisted wake-event receipt is tracked in memory before a hard-check veto", async () => {
  const f = fixture({
    hardCheck: () => ({ ok: false, reason: "pending-input" }),
    gateOptions: { now: () => 789 },
  });
  const observed = {
    ...event(),
    id: "event-private-payload-is-not-saved",
    data: { sessionID, text: "private event payload" },
  };

  assert.deepEqual(await f.gate.event(observed), {
    state: "paused",
    reason: "pending-input",
  });
  assert.equal(f.values.has(`event/${sessionID}`), false);
  assert.deepEqual(await f.gate.status(sessionID), {
    checkedAt: 789,
    state: "paused",
    reason: "pending-input",
    lastEvent: { receivedAt: 789, type: "session.idle" },
  });
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
});

test("only a valid strict-JSON continue decision queues exactly one prompt", async () => {
  const f = fixture();
  const result = await f.gate.event(event());
  assert.deepEqual(result, { state: "prompted", turns: 1 });
  assert.deepEqual(f.calls.map(([name]) => name), [
    "binding", "hardCheck", "decide", "binding", "hardCheck", "binding", "hardCheck", "binding", "prompt",
  ]);
  assert.equal(f.count("prompt"), 1);
  const decisionInput = f.calls.find(([name]) => name === "decide")[1];
  assert.deepEqual(decisionInput, {
    sessionID,
    ticket,
    todo,
    ticketContent: binding.ticketContent,
    todoContent: binding.todoContent,
    lastMessage: boundary().lastMessage,
  });
  const promptInput = f.calls.find(([name]) => name === "prompt")[1];
  assert.equal(promptInput.sessionID, sessionID);
  assert.equal(promptInput.ticket, ticket);
  assert.equal(promptInput.todo, todo);
  assert.equal(promptInput.task, "Continue scoped work");
  assert.match(promptInput.id, /^msg_/);
});

test("complete, blocked, ask_user, malformed output, and model failure admit no prompt", async () => {
  for (const output of [
    answer("complete"),
    answer("blocked"),
    answer("ask_user"),
    '{"decision":"continue","reason":"Scoped task remains.","extra":true}',
    '{"decision":"Continue","reason":"Scoped task remains."}',
    JSON.stringify({ decision: "continue", task: "Unapproved task", reason: "Ready." }),
    "not JSON",
    null,
  ]) {
    const f = fixture({ decide: () => output });
    const result = await f.gate.event(event());
    assert.equal(result.state, "paused");
    assert.equal(f.count("decide"), 1);
    assert.equal(f.count("prompt"), 0);
  }

  const failed = fixture({ decide: () => { throw new Error("model unavailable"); } });
  assert.deepEqual(await failed.gate.event(event()), {
    state: "paused", reason: "decision-unavailable",
  });
  assert.equal(failed.count("prompt"), 0);
});

test("status exposes only the latest evaluation state and sanitized reason", async () => {
  const f = fixture({
    decide: () => answer("blocked", "Sensitive model explanation", null),
  });
  assert.deepEqual(await f.gate.status(sessionID), {
    state: "unavailable",
    reason: "no-evaluation-recorded",
  });

  assert.deepEqual(await f.gate.event(event()), {
    state: "paused",
    reason: "blocked",
    detail: "Sensitive model explanation",
  });
  const status = await f.gate.status(sessionID);
  assert.equal(status.state, "paused");
  assert.equal(status.reason, "blocked");
  assert.equal(typeof status.checkedAt, "number");
  assert.deepEqual(Object.keys(f.values.get(`evaluation/${sessionID}`)).sort(), [
    "checkedAt", "reason", "state",
  ]);
  assert.doesNotMatch(JSON.stringify(f.values.get(`evaluation/${sessionID}`)), /Sensitive/);

  assert.deepEqual(await f.gate.status("ses_other"), {
    state: "ignored",
    reason: "session-not-allowlisted",
  });
});

test("status validates persisted metadata and reports storage read failures", async () => {
  const f = fixture({ initialStorage: [[`evaluation/${sessionID}`, {
    checkedAt: 123,
    state: "prompted",
    reason: "model said continue",
    task: "Sensitive task text",
  }]] });
  assert.deepEqual(await f.gate.status(sessionID), {
    state: "unavailable",
    reason: "no-evaluation-recorded",
  });

  f.values.set(`evaluation/${sessionID}`, {
    checkedAt: 123,
    state: "prompted",
    reason: "prompt-admission-failed",
    task: "Sensitive task text",
  });
  assert.deepEqual(await f.gate.status(sessionID), {
    checkedAt: 123,
    state: "prompted",
    reason: "prompt-admission-failed",
  });

  f.storage.get = async () => { throw new Error("storage unavailable"); };
  assert.deepEqual(await f.gate.status(sessionID), {
    state: "unavailable",
    reason: "status-unavailable",
  });
});

test("status includes a read-only preflight without evaluating or prompting", async () => {
  const f = fixture({
    diagnose: async () => ({
      state: "unavailable",
      reason: "location-form-status-unavailable",
    }),
  });

  assert.deepEqual(await f.gate.status(sessionID), {
    state: "unavailable",
    reason: "no-evaluation-recorded",
    preflight: {
      state: "unavailable",
      reason: "location-form-status-unavailable",
    },
  });
  assert.equal(f.count("diagnose"), 1);
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
});

test("status reports event subscription health without evaluating or prompting", async () => {
  const f = fixture();
  f.gate.setEventStreamState("retrying");

  assert.deepEqual(await f.gate.status(sessionID), {
    state: "unavailable",
    reason: "no-evaluation-recorded",
    eventStream: "retrying",
  });
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
});

test("status health metadata accompanies a saved evaluation without changing it", async () => {
  const f = fixture({
    initialStorage: [[`evaluation/${sessionID}`, {
      checkedAt: 123,
      state: "paused",
      reason: "pending-input",
    }]],
  });
  f.gate.setEventStreamState("listening");

  assert.deepEqual(await f.gate.status(sessionID), {
    checkedAt: 123,
    state: "paused",
    reason: "pending-input",
    eventStream: "listening",
  });
  assert.deepEqual(f.values.get(`evaluation/${sessionID}`), {
    checkedAt: 123,
    state: "paused",
    reason: "pending-input",
  });
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
});

test("status refreshes preflight independently from saved evaluation and sanitizes diagnostic failures", async () => {
  const saved = {
    checkedAt: 123,
    state: "paused",
    reason: "blocked",
  };
  let current = { state: "ready", reason: "pending-status-clear" };
  const f = fixture({
    initialStorage: [[`evaluation/${sessionID}`, saved]],
    diagnose: async () => {
      if (current instanceof Error) throw current;
      return current;
    },
  });

  assert.deepEqual(await f.gate.status(sessionID), {
    ...saved,
    preflight: { state: "ready", reason: "pending-status-clear" },
  });
  current = { state: "paused", reason: "permission-requested" };
  assert.deepEqual(await f.gate.status(sessionID), {
    ...saved,
    preflight: { state: "paused", reason: "permission-requested" },
  });
  current = new Error("sensitive diagnostic detail");
  assert.deepEqual(await f.gate.status(sessionID), {
    ...saved,
    preflight: { state: "unavailable", reason: "diagnostic-unavailable" },
  });

  assert.equal(f.count("diagnose"), 3);
  assert.equal(f.count("binding"), 0);
  assert.equal(f.count("hardCheck"), 0);
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
  assert.deepEqual(f.values.get(`evaluation/${sessionID}`), saved);
});

test("metadata persistence failures do not change evaluation results", async () => {
  const f = fixture({ gateOptions: { now: () => 789 } });
  f.storage.set = async (key, value) => {
    if (key.startsWith("evaluation/")) throw new Error("storage unavailable");
    f.values.set(key, structuredClone(value));
  };

  assert.deepEqual(await f.gate.event(event()), { state: "prompted", turns: 1 });
  assert.deepEqual(await f.gate.status(sessionID), {
    state: "unavailable",
    reason: "no-evaluation-recorded",
    lastEvent: { receivedAt: 789, type: "session.idle" },
  });
});

test("ignored evaluations persist only a bounded safe reason", async () => {
  const f = fixture({
    binding: () => ({ ok: false, reason: "Sensitive explanation about ticket contents" }),
    gateOptions: { now: () => 456 },
  });

  assert.deepEqual(await f.gate.event(event()), {
    state: "ignored",
    reason: "Sensitive explanation about ticket contents",
  });
  assert.deepEqual(await f.gate.status(sessionID), {
    checkedAt: 456,
    state: "ignored",
    reason: "evaluation-unavailable",
    lastEvent: { receivedAt: 456, type: "session.idle" },
  });
  assert.deepEqual(Object.keys(f.values.get(`evaluation/${sessionID}`)).sort(), [
    "checkedAt", "reason", "state",
  ]);
});

test("a repeated idle boundary is evaluated at most once", async () => {
  const f = fixture();
  await f.gate.event(event());
  const repeated = await f.gate.event(event());
  assert.deepEqual(repeated, { state: "ignored", reason: "idle-already-evaluated" });
  assert.equal(f.count("decide"), 1);
  assert.equal(f.count("prompt"), 1);
});

test("a saved stop prevents later model decisions and prompts", async () => {
  const f = fixture();
  assert.deepEqual(await f.gate.stop(sessionID), { state: "paused", reason: "user-stopped" });
  const afterStop = f.count("decide");
  assert.deepEqual(await f.gate.event(event()), { state: "paused", reason: "user-stopped" });
  assert.equal(f.count("decide"), afterStop);
  assert.equal(f.count("prompt"), 0);
});

test("a stop racing model generation wins before prompt admission", async () => {
  let releaseDecision;
  const decisionPending = new Promise((resolve) => { releaseDecision = resolve; });
  const f = fixture({ decide: async () => decisionPending });
  const pending = f.gate.event(event());
  while (f.count("decide") === 0) await tick();
  await f.gate.stop(sessionID);
  releaseDecision(answer());
  assert.deepEqual(await pending, { state: "paused", reason: "user-stopped" });
  assert.equal(f.count("prompt"), 0);
});

test("changed ticket content or idle boundary during generation prevents prompt admission", async () => {
  const changedTicket = fixture({
    binding: (() => {
      let calls = 0;
      return async () => (++calls === 1 ? binding : { ...binding, signature: "binding-v2" });
    })(),
  });
  assert.deepEqual(await changedTicket.gate.event(event()), {
    state: "paused", reason: "ticket-changed",
  });
  assert.equal(changedTicket.count("prompt"), 0);

  const changedIdle = fixture({
    hardCheck: (() => {
      let calls = 0;
      return async () => (++calls === 1 ? boundary("idle-1") : boundary("idle-2"));
    })(),
  });
  assert.deepEqual(await changedIdle.gate.event(event()), {
    state: "paused", reason: "session-changed-during-decision",
  });
  assert.equal(changedIdle.count("prompt"), 0);
});

test("ticket changes during the final state write prevent prompt admission", async () => {
  let bindingReads = 0;
  const f = fixture({
    binding: async () => (++bindingReads < 3 ? binding : { ...binding, signature: "binding-v2" }),
  });
  assert.deepEqual(await f.gate.event(event()), { state: "paused", reason: "ticket-changed" });
  assert.equal(f.count("decide"), 1);
  assert.equal(f.count("prompt"), 0);
});

test("ticket changes during the final hard check prevent prompt admission", async () => {
  let bindingReads = 0;
  const f = fixture({
    binding: async () => (++bindingReads < 4 ? binding : { ...binding, signature: "binding-v2" }),
  });
  assert.deepEqual(await f.gate.event(event()), { state: "paused", reason: "ticket-changed" });
  assert.equal(f.count("decide"), 1);
  assert.equal(f.count("prompt"), 0);
});

test("turn and age limits fail closed before hard checks or model decisions", async () => {
  const oldTurnState = [[`session/${sessionID}`, {
    sessionID, turns: 2, startedAt: 100, stopped: false,
  }]];
  const turns = fixture({
    initialStorage: oldTurnState,
    gateOptions: { maxTurns: 2, now: () => 101 },
  });
  assert.deepEqual(await turns.gate.event(event()), { state: "paused", reason: "limit-reached" });
  assert.equal(turns.count("hardCheck"), 0);
  assert.equal(turns.count("decide"), 0);

  const age = fixture({
    initialStorage: [[`session/${sessionID}`, {
      sessionID, turns: 0, startedAt: 100, stopped: false,
    }]],
    gateOptions: { maxAge: 10, now: () => 110 },
  });
  assert.deepEqual(await age.gate.event(event()), { state: "paused", reason: "limit-reached" });
  assert.equal(age.count("hardCheck"), 0);
  assert.equal(age.count("decide"), 0);
});

test("duplicate concurrent events for one session share a single evaluation and admission", async () => {
  let releaseDecision;
  const decisionPending = new Promise((resolve) => { releaseDecision = resolve; });
  const f = fixture({ decide: async () => decisionPending });
  const first = f.gate.event(event());
  while (f.count("decide") === 0) await tick();
  const second = await f.gate.event(event("session.instructions.updated"));
  releaseDecision(answer());
  const firstResult = await first;
  assert.equal(firstResult.state, "prompted");
  assert.deepEqual(second, { state: "ignored", reason: "already-checking-or-closed" });
  assert.equal(f.count("decide"), 1);
  assert.equal(f.count("prompt"), 1);
});

test("unrelated event types are ignored without touching session APIs", async () => {
  const f = fixture();
  assert.deepEqual(await f.gate.event(event("message.updated")), {
    state: "ignored", reason: "event-not-relevant",
  });
  assert.deepEqual(f.calls, []);
});

test("an idle session-status transition wakes the gate", async () => {
  const f = fixture({ gateOptions: { now: () => 789 } });
  assert.ok(wakeEventTypes.includes("session.status"));
  assert.deepEqual(await f.gate.event({
    type: "session.status",
    properties: { sessionID, status: { type: "idle" } },
  }), { state: "prompted", turns: 1 });
  const status = await f.gate.status(sessionID);
  assert.deepEqual(status.lastEvent, {
    receivedAt: status.checkedAt,
    type: "session.status",
  });
  assert.equal(f.count("decide"), 1);
  assert.equal(f.count("prompt"), 1);
});

test("a non-idle session-status transition is ignored", async () => {
  const f = fixture();
  assert.deepEqual(await f.gate.event({
    type: "session.status",
    properties: { sessionID, status: { type: "busy" } },
  }), { state: "ignored", reason: "session-not-idle" });
  assert.equal(f.count("binding"), 0);
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
});

test("idle session-status events remain restricted to exact allowlisted sessions", async () => {
  const f = fixture();
  assert.deepEqual(await f.gate.event({
    type: "session.status",
    properties: { sessionID: "ses_ticket-extra", status: { type: "idle" } },
  }), { state: "ignored", reason: "session-not-allowlisted" });
  assert.equal(f.count("binding"), 0);
  assert.equal(f.count("hardCheck"), 0);
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
  assert.equal(f.values.has("event/ses_ticket-extra"), false);
});

test("the session allowlist gates events, scans, and stop commands", async () => {
  const f = fixture({
    sessions: () => [sessionID, "ses_other", sessionID],
    binding: () => ({ ok: false, reason: "test-filtered" }),
    gateOptions: { allowedSessionIDs: [sessionID] },
  });
  assert.deepEqual(await f.gate.event(event("session.idle", "ses_other")), {
    state: "ignored", reason: "session-not-allowlisted",
  });
  assert.equal(f.values.has("event/ses_other"), false);
  assert.deepEqual(await f.gate.stop("ses_other"), {
    state: "ignored", reason: "session-not-allowlisted",
  });
  const results = await f.gate.scan();
  assert.equal(results.length, 1);
  assert.deepEqual(
    [...new Set(f.calls.filter(([name]) => name === "binding").map(([, id]) => id))],
    [sessionID],
  );
  assert.equal(f.count("decide"), 0);
  assert.equal(f.count("prompt"), 0);
});

test("an empty session allowlist disables evaluation and scanning", async () => {
  const f = fixture({ gateOptions: { allowedSessionIDs: [] } });
  assert.deepEqual(await f.gate.event(event()), {
    state: "ignored", reason: "session-not-allowlisted",
  });
  assert.deepEqual(await f.gate.scan(), []);
  assert.deepEqual(f.calls, []);
});

test("startup scan considers each listed session", async () => {
  const considered = [];
  const f = fixture({
    sessions: () => [sessionID, "ses_two"],
    gateOptions: { allowedSessionIDs: [sessionID] },
    binding: (id) => {
      considered.push(id);
      return { ok: false, reason: "session-not-eligible" };
    },
  });
  const results = await f.gate.scan();
  assert.deepEqual(considered, [sessionID]);
  assert.deepEqual(results, [
    { state: "ignored", reason: "session-not-eligible" },
  ]);
  assert.equal(f.count("sessions"), 1);
});
