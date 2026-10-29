import assert from "node:assert/strict";
import test from "node:test";
import { createDocContentAdapter } from "../src/views/docs/docContent.js";

test("content adapter binds one window sanitizer and exposes only its result for Markdown", () => {
  // Boundary doubles only: this does not execute a sanitizer, DOM, or JSX.
  const windowContext = { windowMarker: true };
  const calls = [];
  const prepare = createDocContentAdapter(windowContext, {
    createSanitizer: (context) => {
      assert.equal(context, windowContext);
      calls.push("factory");
      return {
        sanitize: (html) => {
          calls.push(["sanitize", html]);
          return "sanitized-result";
        },
      };
    },
    parseMarkdown: (text) => {
      calls.push(["parse", text]);
      return "parsed-result";
    },
  });
  assert.equal(prepare(null), null);
  assert.deepEqual(prepare({ path: "README.MD", contents: "# exact\n" }), {
    kind: "markdown",
    html: "sanitized-result",
  });
  assert.deepEqual(
    prepare({ path: "notes.TXT", contents: "<b>literal</b>\n" }),
    { kind: "text", text: "<b>literal</b>\n" },
  );
  assert.deepEqual(prepare({ path: "next.md", contents: "" }), {
    kind: "markdown",
    html: "sanitized-result",
  });
  assert.deepEqual(calls, [
    "factory",
    ["parse", "# exact\n"],
    ["sanitize", "parsed-result"],
    ["parse", ""],
    ["sanitize", "parsed-result"],
  ]);
});
