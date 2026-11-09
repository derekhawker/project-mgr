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
const temp = await mkdtemp(join(tmpdir(), "workspace-ticket-viewer-dom-"));
const entry = join(temp, "entry.js");
await writeFile(
  entry,
  `
  export { render } from ${JSON.stringify(resolve(root, "node_modules/solid-js/web/dist/web.js"))};
  export { createComponent, createSignal } from ${JSON.stringify(resolve(root, "node_modules/solid-js/dist/solid.js"))};
  export { WorkspaceTicketViewer } from ${JSON.stringify(resolve(root, "src/views/workbench/WorkspaceTicketViewer.jsx"))};
`,
);
try {
  await build({
    configFile: false,
    resolve: { alias: presentationAliases },
    root,
    plugins: [solid()],
    logLevel: "silent",
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
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "Event"])
  globalThis[key] = key === "window" ? window : key === "document" ? window.document : window[key];
const { render, createComponent, createSignal, WorkspaceTicketViewer } =
  await import(pathToFileURL(join(temp, "out/test.js")));

function mount(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => createComponent(WorkspaceTicketViewer, props), host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}

const longContent = "x".repeat(1300);
const tickets = [
  { filename: "one.md", title: "First", status: "open", content: longContent },
  { filename: "two.md", title: "Second", status: "closed", content: "Second body" },
];

test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test("ticket selection calls only selection, and previews/details are truncated with status", () => {
  const [selected, setSelected] = createSignal(null);
  const calls = [];
  const view = mount({
    tickets: () => tickets,
    selectedFilename: selected,
    loading: () => false,
    error: () => "",
    onSelect: (filename) => { calls.push(["select", filename]); setSelected(filename); },
    onArchiveChange: (archived) => calls.push(["archive", archived]),
    onCreate: () => calls.push(["create"]),
    onRefresh: () => calls.push(["refresh"]),
    onWork: (filename) => calls.push(["work", filename]),
  });
  try {
    const first = [...view.host.querySelectorAll("li")][0];
    assert.equal(first.querySelector("span").textContent, "open");
    assert.equal(first.querySelector("p").textContent, `${"x".repeat(280)}…`);
    first.querySelector("button").click();
    assert.deepEqual(calls, [["select", "one.md"]]);
    const detail = view.host.querySelector("article");
    assert.equal(detail.getAttribute("aria-label"), "Selected ticket: First");
    assert.equal(detail.querySelector("p").textContent, "Status: open");
    assert.equal(detail.querySelector("pre").textContent, `${"x".repeat(1200)}…`);
    assert.equal(first.querySelector("button").getAttribute("aria-pressed"), "true");
    [...detail.querySelectorAll("button")].find((button) => button.textContent === "Work").click();
    assert.deepEqual(calls, [["select", "one.md"], ["work", "one.md"]]);
  } finally { view.dispose(); }
});

test("archive toggle reports state and clears selection; create and refresh forward callbacks", () => {
  const calls = [];
  const view = mount({
    tickets: () => tickets,
    selectedFilename: () => "two.md",
    loading: () => false,
    error: () => "",
    onSelect: (filename) => calls.push(["select", filename]),
    onArchiveChange: (archived) => calls.push(["archive", archived]),
    onCreate: () => calls.push(["create"]),
    onRefresh: () => calls.push(["refresh"]),
  });
  try {
    view.host.querySelector('button').click();
    [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Refresh tickets").click();
    [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Browse archived tickets").click();
    assert.equal(view.host.querySelector("h2").textContent, "Archived tickets");
    assert.deepEqual(calls, [["create"], ["refresh"], ["archive", true], ["select", null]]);
    [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Show active tickets").click();
    assert.deepEqual(calls.slice(-2), [["archive", false], ["select", null]]);
    assert.equal(view.host.querySelector("h2").textContent, "Tickets");
  } finally { view.dispose(); }
});
