import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { build } from "vite";
import solid from "vite-plugin-solid";
import { presentationAliases } from "../vite.config.js";

const root = resolve(import.meta.dirname, "..");
const temp = await mkdtemp("/tmp/opencode/action-menu-");
const entry = join(temp, "entry.js");
await writeFile(
  entry,
  `
export { render } from ${JSON.stringify(resolve(root, "node_modules/solid-js/web/dist/web.js"))};
export { createComponent, createSignal } from ${JSON.stringify(resolve(root, "node_modules/solid-js/dist/solid.js"))};
export { ActionMenu, ActionMenuItem, ActionMenuGroup, ActionMenuSeparator, Select } from "@ui-lib";
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
for (const key of [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLHeadElement",
  "HTMLBodyElement",
  "Event",
  "MouseEvent",
  "PointerEvent",
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
  createComponent,
  createSignal,
  ActionMenu,
  ActionMenuItem,
  ActionMenuGroup,
  ActionMenuSeparator,
  Select,
} = await import(pathToFileURL(join(temp, "out/test.js")));
function mount(children) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () =>
      createComponent(ActionMenu, {
        label: "Actions",
        get children() {
          return typeof children === "function" ? children() : children;
        },
      }),
    host,
  );
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}
const open = (view) => {
  const details = view.host.querySelector("details");
  details.open = true;
  return details;
};
test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test("outside pointer closes only its disclosure; Escape closes and restores summary focus", () => {
  const button = (text) => {
    const node = document.createElement("button");
    node.textContent = text;
    return node;
  };
  const one = mount(button("Run"));
  const two = mount(button("Other"));
  const first = open(one),
    second = open(two);
  document.body.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true }),
  );
  assert.equal(first.open, false);
  assert.equal(second.open, false);
  open(one);
  const summary = one.host.querySelector("summary");
  one.host.querySelector("button").focus();
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(first.open, false);
  assert.equal(document.activeElement, summary);
  one.dispose();
  two.dispose();
});

test("enabled buttons and links close, disabled actions do not", () => {
  const children = document.createElement("div");
  children.innerHTML =
    '<button disabled>Disabled</button><button aria-disabled="true">Unavailable</button><a aria-disabled="true" href="#">Unavailable link</a><button>Run</button><a href="#next">Next</a>';
  const view = mount(children);
  const details = open(view);
  for (const action of view.host.querySelectorAll(
    'button[disabled], [aria-disabled="true"]',
  )) {
    action.click();
    assert.equal(details.open, true);
  }
  view.host
    .querySelector("button:not([disabled]):not([aria-disabled])")
    .click();
  assert.equal(details.open, false);
  open(view);
  view.host.querySelector("a:not([aria-disabled])").click();
  assert.equal(details.open, false);
  view.dispose();
});

test("menu groups and dividers are semantic; rows retain native button behavior", () => {
  const [disabled, setDisabled] = createSignal(true);
  let calls = 0;
  const view = mount(() => [
    createComponent(ActionMenuGroup, {
      label: "Commands",
      headingLevel: 3,
      get children() {
        return [
          createComponent(ActionMenuItem, {
            id: "run-command",
            "aria-label": "Run command",
            "data-command": "run",
            get disabled() {
              return disabled();
            },
            onClick: () => calls++,
            children: "Run",
          }),
          createComponent(ActionMenuItem, { hidden: true, children: "Hidden" }),
        ];
      },
    }),
    createComponent(ActionMenuSeparator, {}),
  ]);
  const form = document.createElement("form");
  document.body.append(form);
  form.append(view.host);
  let submissions = 0;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submissions++;
  });
  try {
    const group = view.host.querySelector('section[aria-label="Commands"]');
    assert.equal(group.querySelector("h3").textContent, "Commands");
    assert.equal(group.tabIndex, -1);
    assert.equal(view.host.querySelector("hr").tabIndex, -1);
    assert.equal(group.querySelector("button[hidden]").hidden, true);
    const item = group.querySelector("#run-command");
    assert.equal(item.type, "button");
    assert.equal(item.getAttribute("aria-label"), "Run command");
    assert.equal(item.dataset.command, "run");
    const details = open(view);
    item.click();
    assert.equal(calls, 0);
    assert.equal(details.open, true);
    setDisabled(false);
    item.focus();
    assert.equal(document.activeElement, item);
    item.click();
    assert.equal(calls, 1);
    assert.equal(details.open, false);
    assert.equal(submissions, 0);
  } finally {
    view.dispose();
    form.remove();
  }
});

test("Select keeps its form-control API while rendering choices through ActionMenu", async () => {
  const [value, setValue] = createSignal("");
  let changed;
  const host = document.createElement("div");
  document.body.append(host);
  const form = document.createElement("form");
  form.append(host);
  const dispose = render(
    () =>
      createComponent(Select, {
        id: "repository-choice",
        label: "Repository",
        required: true,
        portal: false,
        placeholder: "Choose a repository",
        options: [
          { value: "repo-1", label: "Example repository" },
          { value: "empty", label: "Create an empty workspace" },
        ],
        get value() {
          return value();
        },
        onChange: (next) => {
          changed = next;
          setValue(next);
        },
      }),
    host,
  );
  try {
    const summary = host.querySelector("summary");
    const details = host.querySelector("details");
    const listbox = host.querySelector('[role="listbox"]');
    const options = host.querySelectorAll('[role="option"]');
    assert.equal(summary.getAttribute("role"), "combobox");
    assert.equal(summary.getAttribute("aria-haspopup"), "listbox");
    assert.equal(summary.getAttribute("aria-labelledby"), "repository-choice-label repository-choice-current");
    assert.equal(listbox.getAttribute("aria-label"), "Repository");
    assert.equal(options.length, 2);
    details.open = true;
    await Promise.resolve();
    options[0].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    assert.equal(changed, "repo-1");
    assert.equal(details.open, false);
    assert.equal(host.querySelector("#repository-choice-current").textContent, "Example repository");
    assert.equal(options[0].getAttribute("aria-selected"), "true");
  } finally {
    dispose();
    host.remove();
    form.remove();
  }
});
