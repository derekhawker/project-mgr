import assert from "node:assert/strict";
import test from "node:test";
import { createDocsController } from "../src/views/workspace/docs/docsController.js";
import { createDocsView } from "../src/views/workspace/docs/docsView.js";

const files = [
  { path: "README.md", repositoryId: "api", repositoryName: "api" },
  { path: "README.md", repositoryId: "web", repositoryName: "web" },
  { path: "notes.txt", repositoryId: null, repositoryName: null },
];
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function setup(invoke) {
  let owner = { type: "workspace", id: "w" };
  let opened = 0;
  const view = createDocsView();
  const controller = createDocsController({
    invoke,
    view,
    getOwner: () => owner,
    onOpen: () => {
      opened++;
    },
  });
  return {
    view,
    controller,
    setOwner: (value) => {
      owner = value;
    },
    opened: () => opened,
  };
}

test("production Docs view/controller caches discovery, selects first source, and changes content independently of the list", async () => {
  const calls = [];
  const { view, controller, opened } = setup(async (name, payload) => {
    calls.push({ name, payload });
    return name === "docs_list"
      ? files
      : {
          path: payload.request.path,
          contents: payload.request.repositoryId ?? "home",
        };
  });
  assert.equal(view.buttonDisabled(), true);
  assert.equal(view.visible(), false);
  await controller.refresh();
  assert.equal(view.buttonDisabled(), false);
  await controller.open();
  assert.equal(opened(), 1);
  assert.equal(view.visible(), true);
  assert.equal(view.buttonSelected(), true);
  assert.deepEqual(view.files(), files);
  assert.deepEqual(view.selected(), files[0]);
  assert.deepEqual(view.content(), { path: "README.md", contents: "api" });
  assert.equal(view.pageMessage(), "");
  assert.equal(view.contentMessage(), "");
  assert.equal(calls.filter(({ name }) => name === "docs_list").length, 1);
  await controller.select("README.md", "web");
  assert.deepEqual(view.selected(), { path: "README.md", repositoryId: "web" });
  assert.equal(view.content().contents, "web");
  await controller.select("notes.txt");
  assert.equal(view.content().contents, "home");
  assert.deepEqual(view.files(), files);
  controller.showTerminal();
  assert.equal(view.visible(), false);
  assert.equal(view.buttonSelected(), false);
});

test("confirmed empty discovery disables Docs; discovery failure stays retryable with a page message", async () => {
  let result = [];
  const { view, controller } = setup(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  await controller.refresh();
  await controller.open();
  assert.equal(view.buttonDisabled(), true);
  assert.deepEqual(view.files(), []);
  assert.match(view.pageMessage(), /No Markdown or text/);
  result = new Error("temporary failure");
  await controller.refresh();
  assert.equal(view.buttonDisabled(), false);
  await controller.open();
  assert.match(
    view.pageMessage(),
    /Could not load documents: Error: temporary failure/,
  );
  assert.equal(view.buttonDisabled(), false);
  result = files;
  await controller.refresh();
  assert.equal(view.buttonDisabled(), false);
});

test("pending selection clears prior content; latest source wins over late success or rejection", async () => {
  const reads = [];
  const { view, controller } = setup(async (name) => {
    if (name === "docs_list") return files;
    const read = deferred();
    reads.push(read);
    return read.promise;
  });
  const opening = controller.open();
  await new Promise(setImmediate);
  reads[0].resolve({ path: "README.md", contents: "first" });
  await opening;
  const older = controller.select("README.md", "api");
  assert.equal(view.content(), null);
  assert.equal(view.contentMessage(), "Loading document…");
  const latest = controller.select("README.md", "web");
  reads[2].resolve({ path: "README.md", contents: "latest" });
  await latest;
  reads[1].resolve({ path: "README.md", contents: "obsolete" });
  await older;
  assert.equal(view.content().contents, "latest");
  const failing = controller.select("README.md", "api");
  const home = controller.select("notes.txt");
  reads[4].resolve({ path: "notes.txt", contents: "home" });
  await home;
  reads[3].reject(new Error("obsolete error"));
  await failing;
  assert.equal(view.content().contents, "home");
  const failed = controller.select("README.md", "web");
  reads[5].reject(new Error("unreadable"));
  await failed;
  assert.equal(view.content(), null);
  assert.match(
    view.contentMessage(),
    /Could not load document: Error: unreadable/,
  );
  assert.deepEqual(view.files(), files);
});

test("owner changes reject stale discovery, read results, and read errors; no owner emits no commands", async () => {
  const pending = [];
  const { view, controller, setOwner } = setup(() => {
    const request = deferred();
    pending.push(request);
    return request.promise;
  });
  const discovery = controller.open();
  setOwner({ type: "workspace", id: "other" });
  pending[0].resolve(files);
  await discovery;
  assert.deepEqual(view.files(), []);
  assert.equal(pending.length, 1, "stale discovery must not start a read");
  for (const failure of [false, true]) {
    const read = controller.select("README.md", "api");
    setOwner({ type: "workspace", id: failure ? "last" : "next" });
    const request = pending.at(-1);
    if (failure) request.reject(new Error("stale"));
    else request.resolve({ path: "README.md", contents: "stale" });
    await read;
    assert.equal(view.content(), null);
    assert.equal(view.contentMessage(), "Loading document…");
  }
  const refresh = controller.refresh();
  setOwner(null);
  pending.at(-1).reject(new Error("stale discovery"));
  await refresh;
  const count = pending.length;
  await controller.open();
  await controller.select("notes.txt");
  await controller.refresh();
  assert.equal(pending.length, count);
  assert.equal(view.buttonDisabled(), true);
});
