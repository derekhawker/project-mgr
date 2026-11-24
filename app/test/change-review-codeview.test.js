import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import {
  buildReviewItems,
  createReviewHeaderPrefix,
} from "../src/views/workspace/change-review/reviewItems.js";

test("Pierre CodeView keeps a large review virtualized and jumps to an item", async () => {
  const window = new Window();
  for (const key of [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "MutationObserver",
    "ResizeObserver",
    "CSSStyleSheet",
    "customElements",
    "getComputedStyle",
  ]) {
    globalThis[key] =
      key === "window"
        ? window
        : key === "document"
          ? window.document
          : window[key];
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  const { CodeView, parsePatchFiles } = await import("@pierre/diffs");
  const root = window.document.createElement("div");
  root.style.height = "600px";
  root.style.width = "900px";
  root.style.overflow = "auto";
  Object.defineProperties(root, {
    clientHeight: { value: 600 },
    clientWidth: { value: 900 },
    getBoundingClientRect: {
      value: () => ({
        top: 0,
        bottom: 600,
        left: 0,
        right: 900,
        width: 900,
        height: 600,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    },
  });
  window.document.body.append(root);

  const patch = Array.from(
    { length: 200 },
    (_, index) =>
      `diff --git a/file-${index}.txt b/file-${index}.txt\n--- a/file-${index}.txt\n+++ b/file-${index}.txt\n@@ -1 +1 @@\n-old-${index}\n+new-${index}\n`,
  ).join("");
  const items = parsePatchFiles(patch).flatMap((parsed) =>
    parsed.files.map((file) => ({
      id: file.name,
      type: "diff",
      fileDiff: file,
    })),
  );
  const viewer = new CodeView({
    theme: { dark: "pierre-dark", light: "pierre-light" },
    stickyHeaders: true,
    diffStyle: "unified",
  });

  try {
    viewer.setup(root);
    viewer.setItems(items);
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(items.length, 200);
    assert.ok(viewer.getRenderedItems().length <= 15);
    assert.ok(root.querySelectorAll("*").length <= 20);

    viewer.setOptions({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      stickyHeaders: true,
      diffStyle: "split",
    });
    viewer.scrollTo({
      type: "item",
      id: "file-150.txt",
      behavior: "instant",
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.ok(
      viewer.getRenderedItems().some((item) => item.id === "file-150.txt"),
    );
    assert.ok(viewer.getRenderedItems().length < items.length);
    assert.ok(root.querySelectorAll("*").length < 100);
  } finally {
    viewer.cleanUp();
    await window.happyDOM.abort();
  }
});

test("diff contents cannot create HTML elements in the CodeView DOM", async () => {
  const window = new Window();
  for (const key of [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "MutationObserver",
    "ResizeObserver",
    "CSSStyleSheet",
    "customElements",
    "getComputedStyle",
  ]) {
    globalThis[key] =
      key === "window"
        ? window
        : key === "document"
          ? window.document
          : window[key];
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  const { CodeView, parsePatchFiles } = await import("@pierre/diffs");
  const root = window.document.createElement("div");
  root.style.height = "600px";
  Object.defineProperties(root, {
    clientHeight: { value: 600 },
    getBoundingClientRect: {
      value: () => ({
        top: 0,
        bottom: 600,
        left: 0,
        right: 800,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    },
  });
  window.document.body.append(root);
  const fileDiff = parsePatchFiles(
    "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-before\n+<img src=x onerror=alert(1)>\n",
  )[0].files[0];
  const viewer = new CodeView({
    theme: { dark: "pierre-dark", light: "pierre-light" },
  });

  try {
    viewer.setup(root);
    viewer.setItems([{ id: "a.txt", type: "diff", fileDiff }]);
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(root.querySelectorAll("img").length, 0);
    assert.equal(root.querySelectorAll("script").length, 0);
  } finally {
    viewer.cleanUp();
    await window.happyDOM.abort();
  }
});

test("file heading checkbox marks a diff viewed and collapses or restores it", async () => {
  const window = new Window();
  for (const key of [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "MutationObserver",
    "ResizeObserver",
    "CSSStyleSheet",
    "customElements",
    "getComputedStyle",
  ]) {
    globalThis[key] =
      key === "window"
        ? window
        : key === "document"
          ? window.document
          : window[key];
  }
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  const { CodeView, parsePatchFiles } = await import("@pierre/diffs");
  const root = window.document.createElement("div");
  root.style.height = "600px";
  Object.defineProperties(root, {
    clientHeight: { value: 600 },
    getBoundingClientRect: {
      value: () => ({
        top: 0,
        bottom: 600,
        left: 0,
        right: 800,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON() {},
      }),
    },
  });
  window.document.body.append(root);
  const file = {
    path: "src/a.js",
    status: "M",
    changeSource: "branch",
    viewed: false,
    diff: "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n",
  };
  const review = buildReviewItems(
    [{ repositoryId: "repo-1", files: [file] }],
    parsePatchFiles,
  );
  const calls = [];
  let viewer;
  viewer = new CodeView({
    theme: { dark: "pierre-dark", light: "pierre-light" },
    renderHeaderPrefix: (fileDiff) =>
      createReviewHeaderPrefix({
        ...review,
        viewer,
        styles: {
          reviewHeaderPrefix: "reviewHeaderPrefix",
          viewedControl: "viewedControl",
          sourceBadge: "sourceBadge",
        },
        onViewedChange: async (...args) => calls.push(args),
      })(fileDiff),
  });

  try {
    viewer.setup(root);
    viewer.setItems(review.items);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const checkbox = root.querySelector('[aria-label="Viewed src/a.js"]');
    assert.ok(checkbox);
    checkbox.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(checkbox.checked, true);
    assert.equal(viewer.getItem("repo-1:branch:src%2Fa.js:0").collapsed, true);
    assert.deepEqual(calls, [["repo-1", "src/a.js", true]]);

    const collapsedCheckbox = root.querySelector(
      '[aria-label="Viewed src/a.js"]',
    );
    collapsedCheckbox.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(collapsedCheckbox.checked, false);
    assert.equal(viewer.getItem("repo-1:branch:src%2Fa.js:0").collapsed, false);
    assert.deepEqual(calls[1], ["repo-1", "src/a.js", false]);
  } finally {
    viewer.cleanUp();
    await window.happyDOM.abort();
  }
});
