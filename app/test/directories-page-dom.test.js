import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { build } from "vite";
import solid from "vite-plugin-solid";
import { presentationAliases } from "../vite.config.js";

const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp(join(tmpdir(), "directories-dom-"));
const entry = join(temp, "entry.js");
await writeFile(
  entry,
  `
  export { render } from ${JSON.stringify(resolve(root, "node_modules/solid-js/web/dist/web.js"))};
  export { createComponent } from ${JSON.stringify(resolve(root, "node_modules/solid-js/dist/solid.js"))};
  export { DirectoriesPage } from ${JSON.stringify(resolve(root, "src/views/directories/DirectoriesPage.jsx"))};
  export { RepositoryDirectories } from ${JSON.stringify(resolve(root, "src/views/directories/RepositoryDirectories.jsx"))};
`,
);
try {
  await build({
    configFile: false,
    resolve: { alias: presentationAliases },
    root,
    plugins: [solid()],
    build: {
      outDir: join(temp, "out"),
      lib: { entry, formats: ["es"], fileName: "test" },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
} catch (error) {
  await rm(temp, { recursive: true, force: true });
  throw error;
}
const window = new Window();
for (const key of [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "Event",
])
  globalThis[key] =
    key === "window"
      ? window
      : key === "document"
        ? window.document
        : window[key];
const { render, createComponent, DirectoriesPage, RepositoryDirectories } =
  await import(pathToFileURL(join(temp, "out/test.js")));
test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test("page retains accessible landmarks without a back action", () => {
  const host = document.createElement("div");
  document.body.append(host);
  let backs = 0;
  const dispose = render(
    () =>
      createComponent(DirectoriesPage, {
        visible: () => true,
        status: () => "Scanning",
        onBack: () => backs++,
      }),
    host,
  );
  assert.equal(
    host.querySelector("#directories-page").getAttribute("aria-labelledby"),
    "directories-title",
  );
  assert.equal(
    host.querySelector("#repository-status").getAttribute("role"),
    "status",
  );
  assert.equal(
    host.querySelector("#directory-list").getAttribute("aria-label"),
    "Repositories grouped by directory",
  );
  assert.equal(host.querySelector("#legacy-task-archives"), null);
  assert.equal(host.querySelector("#directories-back"), null);
  assert.equal(backs, 0);
  dispose();
  host.remove();
});

test("repository delete icon starts selection mode and bulk delete submits selected repositories", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const directories = [
    {
      path: "/work/apps",
      repositories: [
        {
          repository: {
            id: "repo-a",
            name: "alpha",
            repositoryPath: "/work/apps/alpha",
          },
          enabled: true,
        },
        {
          repository: {
            id: "repo-b",
            name: "beta",
            repositoryPath: "/work/apps/team/beta",
          },
          enabled: false,
        },
      ],
    },
  ];
  const deleted = [];
  const dispose = render(
    () =>
      createComponent(RepositoryDirectories, {
        directories: () => directories,
        pendingRepositoryId: () => null,
        onToggleRepository: () => {},
        onDeleteMany: async (ids) => deleted.push(ids),
      }),
    host,
  );

  const rootFolder = host.querySelector("details");
  rootFolder.open = false;
  rootFolder.dispatchEvent(new Event("toggle"));
  assert.equal(
    host.querySelector('[aria-label="2 hidden leaf nodes"]').textContent,
    "2",
  );
  rootFolder.open = true;
  rootFolder.dispatchEvent(new Event("toggle"));

  host.querySelector('button[aria-label="Delete Repository alpha"]').click();
  assert.match(host.textContent, /Delete selected \(1\)/);
  assert.equal(
    host.querySelector(
      'input[aria-label="Select repository alpha for deletion"]',
    ).checked,
    true,
  );
  host
    .querySelector('input[aria-label="Select repository beta for deletion"]')
    .click();
  assert.match(host.textContent, /Delete selected \(2\)/);
  host
    .querySelector('button[aria-label="Delete selected repositories"]')
    .click();
  await Promise.resolve();
  assert.deepEqual(deleted, [["repo-a", "repo-b"]]);
  assert.ok(host.querySelector('button[aria-label="Delete Repository alpha"]'));

  dispose();
  host.remove();
});
