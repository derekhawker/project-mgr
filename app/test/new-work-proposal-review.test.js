import test from "node:test";
import assert from "node:assert/strict";
import { prepareProposalReview } from "../src/features/new-work/modal/newWorkProposalReview.js";

const repositoryCatalog = [
  { id: "repo-1", name: "Example", repositoryPath: "/src/example" },
];
test("prepares Quick Request review and falls back to default directory selection", () => {
  const review = prepareProposalReview(
    {
      workType: "quick_request",
      repositories: [{ repositoryId: "missing" }],
    },
    "unchanged original",
    { repositoryCatalog },
  );

  assert.equal(review.title, "New Quick Request — Confirm directory");
  assert.equal(review.createLabel, "Confirm directory and start Quick Request");
  assert.equal(review.originalPrompt, "unchanged original");
  assert.deepEqual(review.quickRequestDirectories, repositoryCatalog);
  assert.equal(review.quickRequestDirectoryId, "");
});

test("rejects Workspace and legacy Task proposals", () => {
  assert.throws(
    () =>
      prepareProposalReview({ workType: "task" }, "prompt", {
        repositoryCatalog,
      }),
    /Only Quick Request proposals can be reviewed/,
  );
  assert.throws(
    () => prepareProposalReview({ workType: "workspace" }, "prompt", { repositoryCatalog }),
    /Only Quick Request proposals can be reviewed/,
  );
});
