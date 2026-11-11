import assert from "node:assert/strict";
import test from "node:test";
import { workspaceTitleFromRepositoryName } from "../src/features/new-work/modal/workspaceTitle.js";

test("repository names become editable word-spaced workspace title suggestions", () => {
  const cases = [
    ["my_repoName", "My Repo Name"],
    ["lower-case_name", "Lower Case Name"],
    ["XMLParser", "XML Parser"],
    [" already__spaced ", "Already Spaced"],
  ];
  for (const [repositoryName, expected] of cases) {
    assert.equal(workspaceTitleFromRepositoryName(repositoryName), expected);
  }
});
