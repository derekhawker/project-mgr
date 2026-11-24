import test from "node:test";
import assert from "node:assert/strict";
import { parsePatchFiles } from "@pierre/diffs";
import { buildReviewItems } from "../src/views/workspace/change-review/reviewItems.js";

test("review items keep branch and working-tree diffs distinct by file identity", () => {
  const repository = {
    repositoryId: "repo-1",
    files: [
      {
        path: "src/shared.js",
        status: "changed",
        changeSource: "branch",
        viewed: true,
        diff: "diff --git a/src/shared.js b/src/shared.js\n--- a/src/shared.js\n+++ b/src/shared.js\n@@ -1 +1 @@\n-before\n+branch\n",
      },
      {
        path: "src/shared.js",
        status: "M",
        changeSource: "workingTree",
        diff: "diff --git a/src/shared.js b/src/shared.js\n--- a/src/shared.js\n+++ b/src/shared.js\n@@ -1 +1 @@\n-branch\n+local\n",
      },
    ],
  };

  const result = buildReviewItems([repository], parsePatchFiles);

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].collapsed, true);
  assert.equal(result.items[1].collapsed, undefined);
  assert.notEqual(result.items[0].id, result.items[1].id);
  assert.match(result.items[0].fileDiff.additionLines.join("\n"), /branch/);
  assert.match(result.items[1].fileDiff.additionLines.join("\n"), /local/);
  assert.equal(
    result.fileByDiff.get(result.items[0].fileDiff).file.changeSource,
    "branch",
  );
  assert.equal(
    result.fileByDiff.get(result.items[1].fileDiff).file.changeSource,
    "workingTree",
  );
  for (const item of result.items) {
    const remountedDiff = { ...item.fileDiff };
    assert.equal(
      result.fileByDiffKey.get(remountedDiff.reviewKey).file.changeSource,
      item.id.includes(":branch:") ? "branch" : "workingTree",
    );
  }
});

test("review items retain files without textual patches as navigable notices", () => {
  const result = buildReviewItems(
    [
      {
        repositoryId: "repo-1",
        files: [
          {
            path: "image.png",
            status: "M",
            changeSource: "branch",
            diff: null,
          },
          {
            path: "broken.txt",
            status: "M",
            changeSource: "branch",
            diff: "",
            diffError: "Binary file",
          },
        ],
      },
    ],
    parsePatchFiles,
  );

  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((item) => item.type === "file"));
  assert.match(result.items[1].file.contents, /Binary file/);
});

test("untracked-file patches are parsed into reviewable CodeView items", () => {
  const result = buildReviewItems(
    [
      {
        repositoryId: "repo-1",
        files: [
          {
            path: "new.txt",
            status: "untracked",
            changeSource: "workingTree",
            diff: "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,1 @@\n+hello\n",
          },
        ],
      },
    ],
    parsePatchFiles,
  );

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].fileDiff.name, "new.txt");
});
