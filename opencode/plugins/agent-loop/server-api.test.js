import assert from "node:assert/strict";
import test from "node:test";
import { reconcile } from "./loop.js";
import { createServerAPI } from "./server-api.js";
import { readSessionLog } from "./server-http.js";

test("history follows older pages until the admitted prompt and its boundary are present", async () => {
  const sessionID = "ses_target";
  const promptID = "admitted-prompt";
  const requests = [];
  const firstPage = [
    { id: "closing-idle", type: "idle", outcome: "succeeded" },
    {
      id: "assistant-final",
      type: "assistant",
      finish: "stop",
      time: { completed: 1 },
      content: [
        { type: "text", text: `Agent loop checkpoint: ${promptID} ready` },
      ],
    },
    ...Array.from({ length: 98 }, (_, index) => ({
      id: `assistant-${index}`,
      type: "assistant",
    })),
  ];
  const api = createServerAPI(
    {
      location: { directory: "/work" },
      message: {
        async list(query) {
          requests.push(query);
          if (!query.cursor)
            return { data: firstPage, cursor: { next: "older-page" } };
          return {
            data: [
              { id: promptID, type: "user" },
              { id: "prior-idle", type: "idle", outcome: "succeeded" },
            ],
            cursor: { next: "oldest-page" },
          };
        },
      },
    },
    async () => {
      throw new Error("unexpected fallback read");
    },
  );

  const history = await api.history(
    { sessionID, turn: { id: promptID, baseline: "prior-idle" } },
    new AbortController().signal,
  );

  assert.deepEqual(requests, [
    { sessionID, order: "desc", limit: 100 },
    { sessionID, cursor: "older-page", limit: 100 },
  ]);
  assert.equal(
    history.messages.findIndex((message) => message.id === promptID),
    100,
  );
  assert.equal(history.messages[101].id, "prior-idle");
  assert.equal(history.truncated, false);
  assert.deepEqual(
    reconcile(history.messages, promptID, "prior-idle", history.truncated),
    { idle: "closing-idle", checkpoint: "ready" },
  );
});

test("admission retry requires a synchronized exact-session log and detects cancellation", async () => {
  const sessionID = "ses_target";
  const turn = { id: "msg_reserved", logAfter: null };
  const cancelled = {
    type: "session.inbox.cancelled", durable: { aggregateID: sessionID, seq: 1 },
    data: { sessionID, inboxID: turn.id },
  };
  const marker = { type: "log.synced", aggregateID: sessionID };
  let frames = [];
  const api = createServerAPI({ location: {} }, undefined, (path) => {
    assert.equal(path, `/api/experimental/session/${sessionID}/log?follow=false`);
    const sse = frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join("");
    return readSessionLog(new Response(sse, { headers: { "content-type": "text/event-stream" } }));
  });
  const check = () => api.retryEvidence({ sessionID, turn });
  frames = [JSON.stringify(marker)];
  assert.deepEqual(await check(), { delivered: false, cursor: null });
  frames = [cancelled, marker];
  assert.deepEqual(await check(), { reason: "prompt-cancelled" });
  frames = [{ ...cancelled, type: "session.execution.interrupted", data: { sessionID } }, marker];
  assert.deepEqual(await check(), { reason: "execution-interrupted" });
  frames = [{ ...cancelled, type: "session.inbox.delivered" }, { ...marker, seq: 1 }];
  assert.deepEqual(await check(), { delivered: true, cursor: 1 });
  frames = [{ ...marker, aggregateID: "ses_wrong" }];
  assert.deepEqual(await check(), { reason: "recovery-log-unavailable" });
  frames = [];
  assert.deepEqual(await check(), { reason: "recovery-log-unavailable" });
});
