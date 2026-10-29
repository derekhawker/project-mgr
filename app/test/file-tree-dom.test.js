import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { build } from "vite";
import solid from "vite-plugin-solid";

const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp("/tmp/opencode/file-tree-");
const entry = join(temp, "entry.js");
await writeFile(
  entry,
  `
export { render } from ${JSON.stringify(resolve(root, "node_modules/solid-js/web/dist/web.js"))};
export { createComponent, createSignal } from ${JSON.stringify(resolve(root, "node_modules/solid-js/dist/solid.js"))};
export { FileTree } from ${JSON.stringify(resolve(root, "src/components/FileTree.jsx"))};
`,
);
await build({
  configFile: false,
  root,
  plugins: [solid()],
  resolve: { alias: { "@ui-lib": resolve(root, "packages/ui-lib/index.js") } },
  logLevel: "silent",
  build: {
    outDir: join(temp, "out"),
    lib: { entry, formats: ["es"], fileName: "test" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const window = new Window();
for (const key of [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "Event",
  "MouseEvent",
])
  globalThis[key] =
    key === "window"
      ? window
      : key === "document"
        ? window.document
        : window[key];
const { render, createComponent, createSignal, FileTree } = await import(
  pathToFileURL(join(temp, "out/test.js"))
);
test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test("nested folders start expanded, can collapse, and retain file identity on selection", () => {
  const files = [
    { path: "README.md" },
    { path: "guides/api/README.md" },
    { path: "guides/intro.md" },
  ];
  const [selected, setSelected] = createSignal(files[0]);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () =>
      createComponent(FileTree, {
        files,
        onSelect: setSelected,
        isSelected: (file) => selected() === file,
      }),
    host,
  );
  const folders = host.querySelectorAll("details");
  assert.equal(folders.length, 2);
  assert.ok([...folders].every((folder) => folder.open));
  assert.equal(folders[0].querySelector("summary span").textContent, "guides");
  assert.equal(folders[1].querySelector("summary span").textContent, "api");
  assert.equal(
    host.querySelectorAll('summary svg[aria-hidden="true"]').length,
    6,
  );
  for (const folder of folders) {
    const paths = folder
      .querySelector(":scope > summary")
      .querySelectorAll("svg path");
    assert.equal(paths.length, 3);
    assert.notEqual(paths[1].getAttribute("d"), paths[2].getAttribute("d"));
  }
  folders[0].open = false;
  folders[0].dispatchEvent(new Event("toggle"));
  assert.equal(folders[0].open, false);
  assert.equal(
    host.querySelector('[aria-label="2 hidden leaf nodes"]').textContent,
    "2",
  );
  folders[0].open = true;
  folders[0].dispatchEvent(new Event("toggle"));
  assert.equal(host.querySelector('[aria-label="2 hidden leaf nodes"]'), null);
  const nested = [...host.querySelectorAll("button")].find(
    (button) => button.title === "guides/api/README.md",
  );
  nested.click();
  assert.equal(selected(), files[1]);
  assert.equal(nested.getAttribute("aria-current"), "true");
  assert.equal(
    host
      .querySelector('button[title="README.md"]')
      .hasAttribute("aria-current"),
    false,
  );
  dispose();
  host.remove();
});
