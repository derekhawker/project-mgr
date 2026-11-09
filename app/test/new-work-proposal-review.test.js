import test from "node:test";
import assert from "node:assert/strict";
import { prepareProposalReview } from "../src/features/new-work/modal/newWorkProposalReview.js";

const repositoryCatalog = [
  { id: "repo-1", name: "Example", repositoryPath: "/src/example" },
];
const repositoryLocations = (repositories, catalog) =>
  repositories.map(({ repositoryId }) => {
    const repository = catalog.find(({ id }) => id === repositoryId);
    return {
      name: repository?.name || repositoryId,
      path: repository?.repositoryPath || "Location unavailable",
    };
  });

test("prepares Workspace review state without changing prompt or reviewed directory semantics", () => {
  const review = prepareProposalReview(
    {
      workType: "workspace",
      workspace: { name: "A workspace" },
      setupPlan: { workspaceHome: "/planned/a-workspace" },
      repositories: [{ repositoryId: "repo-1" }],
      startingPrompt: "  revised starting prompt  ",
    },
    "exact original prompt",
    { repositoryCatalog, repositoryLocations },
  );

  assert.deepEqual(review, {
    workType: "workspace",
    title: "Review New Workspace",
    workspaceName: "A workspace",
      workspaceDirectory: "Existing repository",
    originalPrompt: "exact original prompt",
    startingPrompt: "  revised starting prompt  ",
    createLabel: "Create Workspace",
    repositoryLocations: [{ name: "Example", path: "/src/example" }],
    quickRequestDirectories: null,
    quickRequestDirectoryId: "",
  });
});

test("prepares Quick Request review and falls back to default directory selection", () => {
  const review = prepareProposalReview(
    {
      workType: "quick_request",
      repositories: [{ repositoryId: "missing" }],
    },
    "unchanged original",
    { repositoryCatalog, repositoryLocations },
  );

  assert.equal(review.title, "New Quick Request — Confirm directory");
  assert.equal(review.createLabel, "Confirm directory and start Quick Request");
  assert.equal(review.originalPrompt, "unchanged original");
  assert.deepEqual(review.quickRequestDirectories, repositoryCatalog);
  assert.equal(review.quickRequestDirectoryId, "");
});

test("rejects unsupported proposal work types", () => {
  assert.throws(
    () =>
      prepareProposalReview({ workType: "task" }, "prompt", {
        repositoryCatalog,
        repositoryLocations,
      }),
    /Only Workspace and Quick Request proposals can be created/,
  );
});
