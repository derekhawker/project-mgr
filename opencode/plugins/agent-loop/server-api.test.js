import assert from "node:assert/strict";
import test from "node:test";
import { reconcile } from "./loop.js";
import { createServerAPI } from "./server-api.js";

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
