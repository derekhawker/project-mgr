import assert from "node:assert/strict";
import test from "node:test";
import {
  loadChangeReview,
  loadFullDiff,
} from "../src/views/workspace/change-review/changeReviewUi.js";

const sample = [
  {
    repositoryId: "r1",
    name: "Alpha",
    path: "/repos/alpha",
    comparisonTarget: "origin/main",
    comparisonError: null,
    files: [
      {
        path: "src/a.js",
        status: "M",
        diff: "--- a/src/a.js\n+++ b/src/a.js\n-old\n+new\n",
        diffError: null,
      },
    ],
  },
  {
    repositoryId: "r2",
    name: "Beta",
    path: "/repos/beta",
    comparisonTarget: null,
    comparisonError:
      "Cannot resolve origin/main, origin/master, local main, or local master",
    files: [
      {
        path: "new.txt",
        status: "untracked",
        diff: "+hello\n",
        diffError: null,
      },
    ],
  },
];

test("Change Review adapter sends the selected owner and validates repository response", async () => {
  let sent;
  const result = await loadChangeReview(
    async (name, payload) => {
      sent = { name, payload };
      return sample;
    },
    "task",
    "task-7",
  );
  assert.deepEqual(sent, {
    name: "change_review_load",
    payload: { request: { ownerType: "task", ownerId: "task-7" } },
  });
  assert.equal(result[1].files[0].status, "untracked");
  await assert.rejects(
    () =>
      loadChangeReview(
        async () => [{ ...sample[0], extra: true }],
        "workspace",
        "w1",
      ),
    /unknown field/,
  );
});

test("full-context adapter sends only owner, repository and relative path and validates the result", async () => {
  let sent;
  const result = await loadFullDiff(
    async (name, payload) => {
      sent = { name, payload };
      return "patch";
    },
    "workspace",
    "w1",
    "r1",
    "src/a.js",
  );
  assert.equal(result, "patch");
  assert.deepEqual(sent, {
    name: "change_review_full_diff",
    payload: {
      request: {
        ownerType: "workspace",
        ownerId: "w1",
        repositoryId: "r1",
        path: "src/a.js",
      },
    },
  });
  await assert.rejects(
    () =>
      loadFullDiff(async () => ({ diff: "bad" }), "workspace", "w1", "r1", "a"),
    /must be string/,
  );
  await assert.rejects(
    () =>
      loadFullDiff(
        async () => {
          throw new Error("limit exceeded");
        },
        "workspace",
        "w1",
        "r1",
        "a",
      ),
    /limit exceeded/,
  );
});
