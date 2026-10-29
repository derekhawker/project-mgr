import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { build } from "vite";
import solid from "vite-plugin-solid";
import { presentationAliases } from "../vite.config.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "project-mgr-ui-a11y-"));
const entry = join(temp, "entry.js");
const output = join(temp, "bundle");
await writeFile(
  entry,
  `
  export { render } from ${JSON.stringify(resolve(appRoot, "node_modules/solid-js/web/dist/web.js"))};
  export { createSignal, createComponent } from ${JSON.stringify(resolve(appRoot, "node_modules/solid-js/dist/solid.js"))};
  export { Button, Input, TextArea, Select, Checkbox, Notice } from "@ui-lib";
`,
);
await build({
  configFile: false,
  resolve: { alias: presentationAliases },
  root: appRoot,
  plugins: [solid()],
  build: {
    outDir: output,
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: { entry, formats: ["es"], fileName: "ui-a11y" },
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
  "KeyboardEvent",
])
  globalThis[key] =
    key === "window"
      ? window
      : key === "document"
        ? window.document
        : window[key];
const {
  render,
  createSignal,
  createComponent,
  Button,
  Input,
  TextArea,
  Select,
  Checkbox,
  Notice,
} = await import(pathToFileURL(join(output, "ui-a11y.js")));
const component = (Component, props) => createComponent(Component, props);
const mount = (factory) => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(factory, host);
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
};
test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test("basic controls preserve native disabled, labeling, and announcement overrides", () => {
  const instances = [
    mount(() =>
      component(Button, { disabled: true, type: "submit", children: "Save" }),
    ),
    mount(() => component(Input, { id: "name", disabled: true })),
    mount(() => component(TextArea, { id: "notes", required: true })),
    mount(() =>
      component(Select, { id: "choice", disabled: true, children: "One" }),
    ),
    mount(() =>
      component(Checkbox, { id: "accept", checked: true, disabled: true }),
    ),
    mount(() =>
      component(Notice, {
        role: "alert",
        "aria-live": "assertive",
        message: "Failed",
        status: "error",
      }),
    ),
  ];
  assert.equal(instances[0].host.querySelector("button").type, "submit");
  assert.equal(instances[0].host.querySelector("button").disabled, true);
  assert.equal(instances[1].host.querySelector("#name").disabled, true);
  assert.equal(instances[2].host.querySelector("#notes").required, true);
  assert.equal(instances[3].host.querySelector("#choice").disabled, true);
  assert.equal(instances[4].host.querySelector("#accept").checked, true);
  assert.equal(
    instances[5].host.querySelector("[role=alert]").getAttribute("aria-live"),
    "assertive",
  );
  instances.forEach((instance) => instance.dispose());
});
