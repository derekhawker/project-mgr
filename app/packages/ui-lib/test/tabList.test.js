import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { build } from "vite";
import solid from "vite-plugin-solid";

const root = resolve(import.meta.dirname, "..");
const appRoot = resolve(root, "../..");
const temp = await mkdtemp("/tmp/opencode/ui-lib-tabs-");
const entry = join(temp, "entry.js");
await writeFile(
  entry,
  `
export { render } from ${JSON.stringify(resolve(appRoot, "node_modules/solid-js/web/dist/web.js"))};
export { createSignal, createComponent, For } from ${JSON.stringify(resolve(appRoot, "node_modules/solid-js/dist/solid.js"))};
export { Tabs, TabList, Tab, Button } from ${JSON.stringify(join(root, "index.js"))};
`,
);
try {
  await build({
    configFile: false,
    root,
    plugins: [solid()],
    logLevel: "silent",
    define: { "import.meta.env.DEV": "true" },
    build: {
      outDir: join(temp, "out"),
      lib: { entry, formats: ["es"], fileName: "tabs" },
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
  For,
  Tabs,
  TabList,
  Tab,
  Button,
} = await import(pathToFileURL(join(temp, "out/tabs.js")));
const component = (Component, props) => createComponent(Component, props);
function mount(factory) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(factory, host);
  return {
    host,
    dispose() {
      dispose();
      host.remove();
    },
  };
}
const press = (target, key, overrides = {}) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...overrides,
  });
  target.dispatchEvent(event);
  return event;
};
test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test("TabList controls external panels, skips hidden tabs, and keeps actions out of arrow navigation", () => {
  const [value, setValue] = createSignal("missing");
  const [docsDisabled, setDocsDisabled] = createSignal(false);
  let restarts = 0;
  const mounted = mount(() =>
    component(TabList, {
      label: "Workspace views",
      get value() {
        return value();
      },
      onChange: setValue,
      get children() {
        return [
          component(Tab, {
            value: "code",
            id: "code-tab",
            controls: "code-panel",
            children: "OpenCode",
            get actions() {
              return component(Button, {
                "aria-label": "Restart OpenCode",
                onClick: () => restarts++,
                children: "Restart",
              });
            },
          }),
          component(Tab, {
            value: "hidden",
            hidden: true,
            children: "Other workspace",
          }),
          component(Tab, {
            value: "docs",
            controls: "docs-panel",
            get disabled() {
              return docsDisabled();
            },
            children: "Docs",
          }),
        ];
      },
    }),
  );
  const list = mounted.host.querySelector('[role="tablist"]');
  const [code, hidden, docs] = mounted.host.querySelectorAll('[role="tab"]');
  assert.equal(
    mounted.host.querySelector('[aria-label="Restart OpenCode"]'),
    null,
    "Actions belong only to the selected tab",
  );
  assert.equal(list.getAttribute("aria-label"), "Workspace views");
  assert.equal(code.tabIndex, 0);
  assert.equal(hidden.tabIndex, -1);
  assert.equal(code.getAttribute("aria-controls"), "code-panel");
  assert.equal(code.id, "code-tab");
  code.focus();
  press(code, "ArrowRight");
  assert.equal(value(), "docs");
  assert.equal(document.activeElement, docs);
  assert.equal(docs.getAttribute("aria-selected"), "true");
  press(docs, "ArrowRight");
  assert.equal(value(), "code");
  press(code, "ArrowLeft");
  assert.equal(value(), "docs");
  press(docs, "Home");
  assert.equal(value(), "code");
  const restart = mounted.host.querySelector('[aria-label="Restart OpenCode"]');
  assert.ok(restart);
  assert.equal(
    list.contains(restart),
    false,
    "Action buttons are outside the ARIA tablist",
  );
  press(restart, "ArrowRight");
  assert.equal(value(), "code", "Action keys do not activate adjacent views");
  restart.click();
  assert.equal(restarts, 1);
  assert.equal(value(), "code");
  press(code, "End");
  assert.equal(value(), "docs");
  assert.equal(
    mounted.host.querySelector('[aria-label="Restart OpenCode"]'),
    null,
  );
  setDocsDisabled(true);
  assert.equal(
    code.tabIndex,
    0,
    "Disabled selection retains an enabled keyboard entry",
  );
  press(code, "End");
  assert.equal(value(), "code");
  assert.equal(docs.disabled, true);
  mounted.dispose();
});

test("vertical tabs respect controlled selection and ignore unrelated, prevented, and composing keys", () => {
  let requested;
  const mounted = mount(() =>
    component(TabList, {
      labelledBy: "view-heading",
      orientation: "vertical",
      value: "one",
      onChange: (value) => {
        requested = value;
      },
      get children() {
        return [
          component(Tab, { value: "one", children: "One" }),
          component(Tab, { value: "two", children: "Two" }),
        ];
      },
    }),
  );
  const [one, two] = mounted.host.querySelectorAll('[role="tab"]');
  assert.equal(
    mounted.host
      .querySelector('[role="tablist"]')
      .getAttribute("aria-labelledby"),
    "view-heading",
  );
  for (const [key, overrides] of [
    ["ArrowRight", {}],
    ["Enter", {}],
    ["ArrowDown", { isComposing: true }],
    ["ArrowDown", { keyCode: 229 }],
  ]) {
    assert.equal(press(one, key, overrides).defaultPrevented, false);
    assert.equal(requested, undefined);
  }
  one.addEventListener("keydown", (event) => event.preventDefault(), {
    once: true,
  });
  press(one, "End");
  assert.equal(requested, undefined);
  press(one, "ArrowDown");
  assert.equal(requested, "two");
  assert.equal(document.activeElement, two);
  assert.equal(
    one.getAttribute("aria-selected"),
    "true",
    "Caller remains the selection owner",
  );
  press(two, "ArrowUp");
  assert.equal(requested, "one");
  mounted.dispose();
});

test("each closeable tab has an independent adjacent close button, including inactive tabs", () => {
  const [value, setValue] = createSignal("docs");
  const [busy, setBusy] = createSignal(false);
  const closes = [];
  const mounted = mount(() =>
    component(TabList, {
      label: "Views",
      get value() {
        return value();
      },
      onChange: setValue,
      get children() {
        return [
          component(Tab, {
            value: "code",
            children: "Code",
            closeLabel: "Close Code",
            onClose: () => closes.push("code"),
            get closeDisabled() {
              return busy();
            },
          }),
          component(Tab, {
            value: "tool",
            children: "Tool",
            closeLabel: "Close Tool",
            onClose: () => closes.push("tool"),
          }),
          component(Tab, {
            value: "hidden",
            hidden: true,
            children: "Other owner",
            closeLabel: "Close Other owner",
            onClose: () => closes.push("hidden"),
          }),
          component(Tab, { value: "docs", children: "Docs" }),
          component(Tab, { value: "review", children: "Change Review" }),
        ];
      },
    }),
  );
  const list = mounted.host.querySelector('[role="tablist"]');
  const tabs = [...mounted.host.querySelectorAll('[role="tab"]')];
  const close = mounted.host.querySelector('[aria-label="Close Code"]');
  assert.ok(close, "Inactive Code still has its close button");
  assert.equal(close.parentElement, tabs[0].parentElement);
  assert.equal(tabs[0].contains(close), false, "Never nest buttons");
  assert.equal(
    list.contains(close),
    false,
    "Close buttons are not ARIA tablist children",
  );
  assert.equal(
    mounted.host.querySelector('[aria-label="Close Tool"]').parentElement,
    tabs[1].parentElement,
  );
  assert.equal(
    tabs[3].parentElement.querySelectorAll("button").length,
    1,
    "Docs is not closeable",
  );
  assert.equal(
    tabs[4].parentElement.querySelectorAll("button").length,
    1,
    "Change Review is not closeable",
  );
  assert.equal(
    mounted.host
      .querySelector('[aria-label="Close Other owner"]')
      .closest("[hidden]") !== null,
    true,
  );
  assert.equal(close.getAttribute("type"), "button");
  press(close, "ArrowRight");
  close.click();
  assert.deepEqual(closes, ["code"]);
  assert.equal(value(), "docs", "Close never activates the tab");
  setBusy(true);
  assert.equal(close.disabled, true);
  close.click();
  assert.deepEqual(closes, ["code"]);
  const owned = list.getAttribute("aria-owns").split(" ");
  assert.deepEqual(
    owned,
    tabs.filter((tab) => !tab.closest("[hidden]")).map((tab) => tab.id),
  );
  assert.equal(new Set(owned).size, 4, "Every tab has a distinct owned ID");
  mounted.dispose();
});

test("dynamic tab insertion, reordering, hiding, and removal keep DOM-order keyboard and ARIA membership", async () => {
  const [items, setItems] = createSignal(["a", "b"]);
  const [hidden, setHidden] = createSignal(false);
  const [value, setValue] = createSignal("b");
  const mounted = mount(() =>
    component(TabList, {
      label: "Dynamic views",
      get value() {
        return value();
      },
      onChange: setValue,
      get children() {
        return component(For, {
          get each() {
            return items();
          },
          children: (id) =>
            component(Tab, {
              value: id,
              get hidden() {
                return id === "a" && hidden();
              },
              children: id,
            }),
        });
      },
    }),
  );
  setItems(["c", "b", "a"]);
  await window.happyDOM.whenAsyncComplete();
  let tabs = mounted.host.querySelectorAll('[role="tab"]');
  const list = mounted.host.querySelector('[role="tablist"]');
  assert.equal(
    list.getAttribute("aria-owns"),
    [...tabs].map((tab) => tab.id).join(" "),
  );
  setItems(["a", "c", "b"]);
  await window.happyDOM.whenAsyncComplete();
  tabs = mounted.host.querySelectorAll('[role="tab"]');
  assert.equal(
    list.getAttribute("aria-owns"),
    [...tabs].map((tab) => tab.id).join(" "),
    "Reordering retained nodes also reorders ARIA ownership",
  );
  setItems(["c", "b", "a"]);
  await window.happyDOM.whenAsyncComplete();
  tabs = mounted.host.querySelectorAll('[role="tab"]');
  press(tabs[1], "Home");
  assert.equal(value(), "c");
  press(tabs[0], "End");
  assert.equal(value(), "a");
  setHidden(true);
  assert.equal(tabs[0].tabIndex, 0);
  setItems(["b"]);
  tabs = mounted.host.querySelectorAll('[role="tab"]');
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].tabIndex, 0);
  press(tabs[0], "ArrowRight");
  assert.equal(value(), "b");
  setItems([]);
  assert.equal(mounted.host.querySelector('[role="tab"]'), null);
  mounted.dispose();
});

test("removing a focused close button restores tab focus without stealing focus elsewhere", async () => {
  const [items, setItems] = createSignal(["a", "b"]);
  const mounted = mount(() =>
    component(TabList, {
      label: "Closeable views",
      value: "a",
      get children() {
        return component(For, {
          get each() {
            return items();
          },
          children: (id) =>
            component(Tab, {
              value: id,
              children: id,
              closeLabel: `Close ${id}`,
              onClose: () => setItems(items().filter((item) => item !== id)),
            }),
        });
      },
    }),
  );
  const close = mounted.host.querySelector('[aria-label="Close a"]');
  close.focus();
  close.click();
  await window.happyDOM.whenAsyncComplete();
  assert.equal(
    document.activeElement?.id,
    mounted.host.querySelector('[role="tab"]').id,
  );
  setItems(["a", "b"]);
  mounted.host.querySelector('[aria-label="Close b"]').focus();
  const elsewhere = document.createElement("button");
  document.body.append(elsewhere);
  elsewhere.focus();
  setItems(["a"]);
  await window.happyDOM.whenAsyncComplete();
  assert.equal(document.activeElement === elsewhere, true);
  elsewhere.remove();
  mounted.dispose();
});

test("activation preserves focus when a controlled caller replaces tab records", () => {
  const [items, setItems] = createSignal([{ id: "a" }, { id: "b" }]);
  const [value, setValue] = createSignal("a");
  const mounted = mount(() =>
    component(TabList, {
      label: "Reconciled views",
      get value() {
        return value();
      },
      onChange: (id) => {
        setValue(id);
        setItems(items().map((item) => ({ ...item })));
      },
      get children() {
        return component(For, {
          get each() {
            return items();
          },
          children: (item) =>
            component(Tab, { value: item.id, children: item.id }),
        });
      },
    }),
  );
  const before = mounted.host.querySelectorAll('[role="tab"]');
  press(before[0], "ArrowRight");
  const after = mounted.host.querySelectorAll('[role="tab"]');
  assert.equal(value(), "b");
  assert.notEqual(after[1], before[1]);
  assert.equal(document.activeElement, after[1]);
  after[0].focus();
  after[0].click();
  assert.equal(value(), "a");
  assert.equal(
    document.activeElement,
    mounted.host.querySelector('[role="tab"]'),
  );
  mounted.dispose();
});

test("Tabs links panels and reflects controlled click and keyboard selection", () => {
  const [value, setValue] = createSignal("disabled");
  const mounted = mount(() =>
    component(Tabs, {
      labelledBy: "section-title",
      tabs: [
        { id: "a", label: "Alpha", panel: "A" },
        { id: "disabled", label: "Unavailable", disabled: true, panel: "X" },
        { id: "b", label: "Beta", panel: "B" },
      ],
      get value() {
        return value();
      },
      onChange: setValue,
    }),
  );
  const [alpha, disabled, beta] = mounted.host.querySelectorAll('[role="tab"]');
  assert.equal(alpha.tabIndex, 0);
  assert.equal(disabled.disabled, true);
  press(alpha, "ArrowRight");
  assert.equal(value(), "b");
  assert.equal(beta.getAttribute("aria-selected"), "true");
  const panel = document.getElementById(beta.getAttribute("aria-controls"));
  assert.equal(panel.textContent, "B");
  assert.equal(panel.getAttribute("aria-labelledby"), beta.id);
  assert.equal(panel.hidden, false);
  alpha.click();
  assert.equal(value(), "a");
  assert.equal(panel.hidden, true);
  assert.equal(
    document.getElementById(alpha.getAttribute("aria-controls")).textContent,
    "A",
  );
  mounted.dispose();
});

test("unnamed tab lists warn in development while accessible names avoid warnings", () => {
  const warnings = [];
  const previous = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    for (const Component of [TabList, Tabs]) {
      const unnamed = mount(() => component(Component, { tabs: [] }));
      unnamed.dispose();
      for (const name of [{ label: "Views" }, { labelledBy: "heading" }]) {
        const named = mount(() => component(Component, { tabs: [], ...name }));
        named.dispose();
      }
    }
    assert.deepEqual(warnings, [
      "TabList requires a label or labelledBy.",
      "TabList requires a label or labelledBy.",
    ]);
  } finally {
    console.warn = previous;
  }
});
