import assert from "node:assert/strict";
import test from "node:test";
import { loadDocs, readDoc } from "../src/services/docsUi.js";

test("Docs adapters validate owner-scoped list/read commands, including Workspace-home identity", async () => {
  const files = [
    { path: "README.md", repositoryId: "r-api", repositoryName: "api" },
  ];
  const calls = [];
  const invoke = async (name, payload) => {
    calls.push({ name, payload });
    return name === "docs_list"
      ? files
      : { path: payload.request.path, contents: "# API" };
  };
  assert.deepEqual(await loadDocs(invoke, "workspace", "w"), files);
  assert.deepEqual(await readDoc(invoke, "workspace", "w", files[0]), {
    path: "README.md",
    contents: "# API",
  });
  await readDoc(invoke, "workspace", "w", { path: "notes.txt" });
  assert.deepEqual(calls, [
    {
      name: "docs_list",
      payload: { request: { ownerType: "workspace", ownerId: "w" } },
    },
    {
      name: "docs_read",
      payload: {
        request: {
          ownerType: "workspace",
          ownerId: "w",
          path: "README.md",
          repositoryId: "r-api",
        },
      },
    },
    {
      name: "docs_read",
      payload: {
        request: {
          ownerType: "workspace",
          ownerId: "w",
          path: "notes.txt",
          repositoryId: null,
        },
      },
    },
  ]);
  await assert.rejects(
    () =>
      loadDocs(
        async () => [{ path: "README.md", extra: true }],
        "workspace",
        "w",
      ),
    /unknown field/,
  );
  await assert.rejects(
    () =>
      readDoc(
        async () => ({ path: "notes.txt", contents: 3 }),
        "workspace",
        "w",
        { path: "notes.txt" },
      ),
    /contents must be string/,
  );
});
