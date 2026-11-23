import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import test from "node:test";
import { createLoop, MAX_AGE, reconcile, TURN_LIMIT } from "./loop.js";

const target = {
  sessionID: "ses_target",
  location: { directory: "/work" },
  ticket: "/tickets/test.md",
  todo: "/tickets/test.todo",
};
const marker = (outcome = "succeeded", id = "idle1") => ({
  id,
  type: "idle",
  outcome,
});
const user = (id) => ({ id, type: "user" });
const answer = (text = "Done for now.") => ({
  type: "assistant",
  finish: "stop",
  time: { completed: 5 },
  content: [{ type: "text", text }],
});

test("malformed transcript and assistant content fail closed", () => {
  const own = user("msg_own");
  const prior = marker("succeeded", "prev");
  assert.equal(
    reconcile(null, own.id, prior.id).reason,
    "turn-boundary-ambiguous",
  );
  for (const content of [
    null,
    { type: "text" },
    [null],
    [{ type: "text", text: 1 }],
  ]) {
    assert.equal(
      reconcile(
        [marker(), { ...answer(), content }, own, prior],
        own.id,
        prior.id,
      ).reason,
      "completion-unconfirmed",
    );
  }
});

function fixture(t, overrides = {}) {
  let messages = [marker("succeeded", "baseline")];
  let signature = "a";
  let snapshot = {};
  const prompts = [];
  let released = 0;
  const delay = (signal) =>
    new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      polls.push(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
    });
  const polls = [];
  const loop = createLoop({
    delay,
    maxAge: overrides.maxAge,
    startupIdleGrace: overrides.startupIdleGrace,
    api: {
      arm: async () => ({ ok: true, token: "lease" }),
      scope: async () => ({ ok: true, signature }),
      release: async () => {
        released++;
      },
      snapshot: async () => snapshot,
      history: async () => ({ messages }),
      prompt: async (_r, request) => {
        prompts.push(request);
        return overrides.admit?.(request) ?? request;
      },
      ...overrides.api,
    },
  });
  t.after(loop.close);
  return {
    loop,
    prompts,
    start: (extra) => loop.start({ ...target, ...extra }),
    status: () => loop.status(target.sessionID),
    releaseCount: () => released,
    snapshot: (value) => {
      snapshot = value;
    },
    startupTail(type) {
      messages = [{ id: "startup-live", type }, ...messages];
    },
    settleStartup() {
      messages = [
        marker("succeeded", "startup-idle"),
        answer(),
        ...messages.slice(1),
      ];
    },
    async poll() {
      assert.ok(polls.length);
      polls.shift()();
      await tick();
    },
    finish({ checkpoint, nextSignature = signature, foreign = false } = {}) {
      const { id } = prompts.at(-1);
      const ownIndex = messages.findIndex((message) => message.id === id);
      const prior = ownIndex < 0 ? messages : messages.slice(ownIndex + 1);
      messages = [
        marker("succeeded", `idle-${prompts.length}`),
        answer(checkpoint && `Agent loop checkpoint: ${id} ${checkpoint}`),
        ...(foreign ? [user("msg_foreign")] : []),
        user(id),
        ...prior,
      ];
      signature = nextSignature;
    },
    working() {
      messages = [
        { type: "assistant", time: { created: 5 }, content: [] },
        user(prompts.at(-1).id),
        ...messages,
      ];
    },
  };
}

test("correlates exact durable boundaries, never a later foreign completion", () => {
  const own = user("msg_own"),
    prior = marker("succeeded", "prev");
  assert.deepEqual(
    reconcile([marker(), answer(), own, prior], own.id, prior.id),
    { idle: "idle1", checkpoint: undefined },
  );
  for (const messages of [
    [marker(), answer(), user("foreign"), own, prior],
    [marker(), answer(), marker(), answer(), own, prior],
    [marker(), answer(), own, user("foreign"), prior],
    [marker(), answer(), own],
  ])
    assert.equal(
      reconcile(messages, own.id, prior.id).reason,
      "turn-boundary-ambiguous",
    );
  assert.equal(
    reconcile([marker(), answer(), own], own.id, null, true).reason,
    "turn-boundary-ambiguous",
  );
  assert.equal(
    reconcile([marker("interrupted"), answer(), own, prior], own.id, prior.id)
      .reason,
    "execution-not-successful",
  );
  assert.equal(
    reconcile(
      [marker(), { ...answer(), finish: "length" }, own, prior],
      own.id,
      prior.id,
    ).reason,
    "completion-unconfirmed",
  );
  assert.equal(
    reconcile(
      [marker(), answer(), { type: "compaction" }, own, prior],
      own.id,
      prior.id,
    ).idle,
    "idle1",
  );
  const recoveryNotice = {
    type: "synthetic",
    text: "The previous response was interrupted. Continue from where you left off without repeating completed content.",
  };
  assert.equal(
    reconcile(
      [marker(), answer(), recoveryNotice, own, prior],
      own.id,
      prior.id,
    ).idle,
    "idle1",
  );
  assert.equal(
    reconcile(
      [
        marker(),
        answer(),
        { ...recoveryNotice, text: "foreign synthetic" },
        own,
        prior,
      ],
      own.id,
      prior.id,
    ).reason,
    "turn-boundary-ambiguous",
  );
});

test("waits for the durable idle marker while the admitted turn is running", () => {
  const own = user("msg_own");
  const prior = marker("succeeded", "prev");
  assert.deepEqual(
    reconcile(
      [{ type: "assistant", time: { created: 5 }, content: [] }, own, prior],
      own.id,
      prior.id,
    ),
    { pending: true },
  );
  assert.deepEqual(reconcile([own, prior], own.id, prior.id), {
    pending: true,
  });
});

test("waits briefly for an active session before the first prompt", async (t) => {
  const f = fixture(t, { startupIdleGrace: 30_000 });
  f.snapshot({ busy: true });
  f.start();
  await tick();
  assert.equal(f.status().state, "active");
  assert.equal(f.status().reason, "waiting-for-session-idle");
  assert.equal(f.status().turns, 0);
  assert.equal(f.prompts.length, 0);

  f.snapshot({ busy: false });
  await f.poll();
  assert.equal(f.prompts.length, 1);
  assert.equal(f.status().turns, 1);
});

test("waits for the initial durable idle boundary before submitting", async (t) => {
  const f = fixture(t, { startupIdleGrace: 30_000 });
  f.startupTail("assistant");
  f.start();
  await tick();
  assert.equal(f.status().reason, "waiting-for-idle-boundary");
  assert.equal(f.status().turns, 0);
  assert.equal(f.prompts.length, 0);

  f.settleStartup();
  await f.poll();
  assert.equal(f.prompts.length, 1);
  assert.equal(f.status().turns, 1);
});

test("maximum loop age is 48 hours", () => {
  assert.equal(MAX_AGE, 48 * 60 * 60_000);
});

test("ignores all live success/delivery variants and reconciles without events", async (t) => {
  const f = fixture(t);
  assert.equal(f.status().state, "off");
  f.start();
  await tick();
  for (const durable of [
    undefined,
    { aggregateID: "ses_other", seq: 5 },
    { aggregateID: target.sessionID, seq: "bad" },
    { aggregateID: target.sessionID, seq: 500 },
  ]) {
    for (const type of [
      "session.execution.succeeded",
      "session.inbox.delivered",
      "session.idle",
    ])
      f.loop.event({ type, data: { sessionID: target.sessionID }, durable });
  }
  assert.equal(f.prompts.length, 1);
  f.snapshot({ ownPending: true });
  await f.poll();
  assert.equal(f.prompts.length, 1);
  f.snapshot({});
  f.finish({ nextSignature: "b" });
  await f.poll();
  assert.equal(f.prompts.length, 2);
  f.finish({ foreign: true });
  await f.poll();
  assert.equal(f.status().reason, "turn-boundary-ambiguous");
});

test("keeps polling an active turn until its idle marker is durable", async (t) => {
  const f = fixture(t);
  f.start();
  await tick();
  f.working();
  await f.poll();
  assert.equal(f.status().state, "active");
  assert.equal(f.prompts.length, 1);

  f.finish({ nextSignature: "b" });
  await f.poll();
  assert.equal(f.status().state, "active");
  assert.equal(f.prompts.length, 2);
});

test("completion before the admission reply is reconciled once", async (t) => {
  let respond;
  const f = fixture(t, {
    admit: (request) =>
      request.id && !respond
        ? new Promise((resolve) => {
            respond = () => resolve(request);
          })
        : request,
  });
  f.start();
  await tick();
  f.finish({ nextSignature: "b" });
  assert.equal(f.status().reason, "admitting");
  respond();
  await tick();
  await f.poll();
  assert.equal(f.prompts.length, 2);
});

test("concurrent start and pause while admission is pending never send again", async (t) => {
  let respond;
  const f = fixture(t, {
    admit: (request) =>
      new Promise((resolve) => {
        respond = () => resolve(request);
      }),
  });
  f.start();
  await tick();
  assert.equal(f.start().turns, 1);
  assert.equal(f.start({ sessionID: "ses_other" }).reason, "controller-in-use");
  assert.equal(f.loop.stop("ses_other").state, "off");
  assert.equal(f.loop.stop(target.sessionID).reason, "user-paused");
  respond();
  await tick();
  assert.equal(f.prompts.length, 1);
  assert.equal(f.releaseCount(), 1);
  assert.equal(fixture(t).status().state, "off");
});

test("pending human gates and live safety vetoes never admit another turn", async (t) => {
  const f = fixture(t);
  f.snapshot({ reason: "form-requested" });
  f.start();
  await tick();
  assert.equal(f.prompts.length, 0);
  assert.equal(f.status().reason, "form-requested");
  f.snapshot({});
  f.start();
  await tick();
  f.loop.event({
    type: "permission.asked",
    location: { directory: "/elsewhere" },
    data: { sessionID: target.sessionID },
  });
  assert.equal(f.status().state, "active");
  f.loop.event({
    type: "permission.asked",
    data: { sessionID: target.sessionID },
  });
  await tick();
  assert.equal(f.status().reason, "permission-requested");
  assert.equal(f.prompts.length, 1);
});

test("pauses on a bound checkpoint, repeated checklist, prompt limit and elapsed time", async (t) => {
  const f = fixture(t);
  f.start();
  await tick();
  f.finish({ checkpoint: "blocked" });
  await f.poll();
  assert.equal(f.status().reason, "agent-reported-blocked");
  f.start();
  await tick();
  f.finish();
  await f.poll();
  f.finish();
  await f.poll();
  assert.equal(f.status().reason, "no-progress");
  const promptCount = f.prompts.length;
  f.start({ limit: 1 });
  await tick();
  assert.equal(f.status().limit, TURN_LIMIT);
  for (let turn = 1; turn < TURN_LIMIT; turn++) {
    f.finish({ nextSignature: `signature-${turn}` });
    await f.poll();
  }
  f.finish({ nextSignature: "final-signature" });
  await f.poll();
  assert.equal(f.status().reason, "turn-limit");
  assert.equal(f.prompts.length - promptCount, TURN_LIMIT);
  const bounded = fixture(t, { maxAge: 10 });
  bounded.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(bounded.status().reason, "time-limit");
  assert.equal(bounded.prompts.length, 1);
});
