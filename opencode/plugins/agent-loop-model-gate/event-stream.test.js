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

test("received stream events pass through the session allowlist gate without prompting", async () => {
  const controller = new AbortController();
  const calls = [];
  const gate = createModelGate({
    allowedSessionIDs: ["ses_allowed"],
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

  assert.deepEqual(await result, { state: "ignored", reason: "session-not-allowlisted" });
  assert.deepEqual(calls, []);
});
