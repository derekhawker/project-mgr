import assert from "node:assert/strict";
import test from "node:test";
import { consumeEventStream } from "./event-stream.js";
import { createModelGate } from "./engine.js";

test("event stream reconnects after a failed subscription and continues consuming", async () => {
  const controller = new AbortController();
  const states = [];
  const events = [];
  let attempts = 0;
  await consumeEventStream({
    signal: controller.signal,
    onState: (state) => states.push(state),
    onEvent: (event) => {
      events.push(event);
      controller.abort();
    },
    wait: async (_ms, signal) => {
      assert.equal(signal.aborted, false);
    },
    subscribe: () => {
      attempts += 1;
      if (attempts === 1)
        return (async function* () { throw new Error("private stream error"); })();
      return (async function* () { yield { type: "session.idle" }; })();
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(events, [{ type: "session.idle" }]);
  assert.deepEqual(states, ["listening", "retrying", "listening", "closed"]);
});

test("event stream awaits the SDK subscription result before listening", async () => {
  const controller = new AbortController();
  const states = [];
  const events = [];
  let resolveSubscription;
  let attempts = 0;
  const subscription = new Promise((resolve) => { resolveSubscription = resolve; });
  const consuming = consumeEventStream({
    signal: controller.signal,
    subscribe: () => {
      attempts += 1;
      return attempts === 1
        ? subscription
        : (async function* () { yield { type: "session.idle" }; })();
    },
    onEvent: (event) => {
      events.push(event);
      controller.abort();
    },
    onState: (state) => states.push(state),
    wait: async () => {},
  });

  await Promise.resolve();
  const statesBeforeResolve = [...states];
  resolveSubscription({
    stream: (async function* () { yield { type: "session.idle" }; })(),
  });
  await consuming;

  assert.deepEqual(statesBeforeResolve, []);
  assert.deepEqual(events, [{ type: "session.idle" }]);
  assert.deepEqual(states, ["listening", "closed"]);
});

test("event stream retries a rejected async subscription and consumes the SDK stream result", async () => {
  const controller = new AbortController();
  const states = [];
  const events = [];
  const waits = [];
  let attempts = 0;

  await consumeEventStream({
    signal: controller.signal,
    subscribe: () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error("private subscription error"));
      return Promise.resolve({
        stream: (async function* () { yield { type: "session.idle" }; })(),
      });
    },
    onEvent: (event) => {
      events.push(event);
      controller.abort();
    },
    onState: (state) => states.push(state),
    wait: async (ms) => { waits.push(ms); },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(events, [{ type: "session.idle" }]);
  assert.deepEqual(states, ["retrying", "listening", "closed"]);
});

test("aborting a pending subscription that rejects on its signal closes without retrying", async () => {
  const controller = new AbortController();
  const states = [];
  let attempts = 0;
  let rejectSubscription;
  const subscription = new Promise((_resolve, reject) => { rejectSubscription = reject; });

  const consuming = consumeEventStream({
    signal: controller.signal,
    subscribe: ({ signal }) => {
      attempts += 1;
      signal.addEventListener("abort", () => rejectSubscription(new Error("aborted")), { once: true });
      return subscription;
    },
    onEvent: () => assert.fail("an aborted subscription must not emit events"),
    onState: (state) => states.push(state),
    wait: async () => assert.fail("an aborted subscription must not retry"),
  });

  await Promise.resolve();
  controller.abort();
  await consuming;

  assert.equal(attempts, 1);
  assert.deepEqual(states, ["closed"]);
});

test("event stream retries after normal termination until aborted", async () => {
  const controller = new AbortController();
  const states = [];
  let attempts = 0;
  await consumeEventStream({
    signal: controller.signal,
    onState: (state) => {
      states.push(state);
      if (state === "retrying" && attempts === 2) controller.abort();
    },
    onEvent: () => assert.fail("empty streams must not emit events"),
    wait: async () => {},
    subscribe: () => {
      attempts += 1;
      return (async function* () {})();
    },
  });

  assert.equal(attempts, 2);
  assert.deepEqual(states, ["listening", "retrying", "listening", "retrying", "closed"]);
});

test("aborting during retry wait closes without opening another subscription", async () => {
  const controller = new AbortController();
  const states = [];
  let attempts = 0;
  await consumeEventStream({
    signal: controller.signal,
    onState: (state) => states.push(state),
    onEvent: () => assert.fail("the stream emitted no events"),
    wait: async (_ms, signal) => {
      assert.equal(signal, controller.signal);
      controller.abort();
    },
    subscribe: () => {
      attempts += 1;
      throw new Error("subscription unavailable");
    },
  });

  assert.equal(attempts, 1);
  assert.deepEqual(states, ["retrying", "closed"]);
});

test("received stream events reach ticket binding without prompting unbound sessions", async () => {
  const controller = new AbortController();
  const calls = [];
  const gate = createModelGate({
    storage: { get: async () => undefined, set: async () => {} },
    api: {
      binding: async (...args) => { calls.push(["binding", ...args]); },
      hardCheck: async (...args) => { calls.push(["hardCheck", ...args]); },
      decide: async (...args) => { calls.push(["decide", ...args]); },
      prompt: async (...args) => { calls.push(["prompt", ...args]); },
    },
  });
  const received = { type: "session.idle", properties: { sessionID: "ses_other" } };
  let result;

  await consumeEventStream({
    signal: controller.signal,
    subscribe: () => (async function* () { yield received; })(),
    onEvent: (event) => {
      assert.equal(event, received);
      result = gate.event(event);
      controller.abort();
    },
    onState: () => {},
    wait: async () => assert.fail("aborting after the event must not retry"),
  });

  assert.deepEqual(await result, { state: "ignored", reason: "ticket-unavailable" });
  assert.deepEqual(calls, [["binding", "ses_other"]]);
});
