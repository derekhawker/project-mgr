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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "work-area-test-"));
const entry = join(temp, "entry.js");
await writeFile(
  entry,
  `
  export { render } from ${JSON.stringify(resolve(root, "node_modules/solid-js/web/dist/web.js"))};
  export { createComponent, createSignal } from ${JSON.stringify(resolve(root, "node_modules/solid-js/dist/solid.js"))};
  export { QuickRequestHistoryPage } from ${JSON.stringify(resolve(root, "src/views/quick-requests/QuickRequestHistoryPage.jsx"))};
  export { DocsPane } from ${JSON.stringify(resolve(root, "src/views/workspace/docs/DocsPane.jsx"))};
  export { WorkspaceTicketContent } from ${JSON.stringify(resolve(root, "src/views/workspace/tickets/WorkspaceTicketContent.jsx"))};
  export { ChangeReviewPanel } from ${JSON.stringify(resolve(root, "src/views/workspace/change-review/ChangeReviewPanel.jsx"))};
  export { WorkspaceOwnerPanel } from ${JSON.stringify(resolve(root, "src/views/workspace/sessions/WorkspaceOwnerPanel.jsx"))};
  export { TerminalSurface } from ${JSON.stringify(resolve(root, "src/views/workspace/sessions/TerminalSurface.jsx"))};
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
  "customElements",
  "CSSStyleSheet",
  "Event",
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
  QuickRequestHistoryPage,
  DocsPane,
  WorkspaceTicketContent,
  ChangeReviewPanel,
  WorkspaceOwnerPanel,
  TerminalSurface,
} = await import(pathToFileURL(join(temp, "out/test.js")));
test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});
function mount(component, props) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => createComponent(component, props), host);
  return {
    host,
    dispose() {
      dispose();
      host.remove();
    },
  };
}

test("Quick Request search and actions retain their callbacks and labels", () => {
  const record = { task: { id: "one" }, prompt: "Original prompt" };
  const calls = [];
  const view = mount(QuickRequestHistoryPage, {
    visible: () => true,
    records: () => [record],
    selectedId: () => null,
    onNew: () => calls.push("new"),
    onSearch: (value) => calls.push(value),
    onOpen: (value) => calls.push(value),
    onDeleteMany: (ids) => {
      calls.push(ids);
      return Promise.resolve();
    },
  });
  const input = view.host.querySelector("input");
  input.value = "find";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  view.host.querySelector("#new-quick-request").click();
  view.host
    .querySelector('[aria-label="Open Quick Request: Original prompt"]')
    .click();
  view.host
    .querySelector('[aria-label="Delete Quick Request: Original prompt"]')
    .click();
  const checkbox = view.host.querySelector('input[type="checkbox"]');
  assert.equal(
    checkbox.checked,
    true,
    "the row whose Delete action was used starts selected",
  );
  [...view.host.querySelectorAll("button")]
    .find((button) => button.textContent.startsWith("Delete selected"))
    .click();
  assert.deepEqual(calls, ["find", "new", record, ["one"]]);
  view.dispose();
});

test("Change Review controls preserve mode without a back button", () => {
  const [mode, setMode] = createSignal("unified");
  let back = 0;
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    loading: () => false,
    repositories: () => [],
    summary: () => "",
    error: () => "",
    mode,
    onMode: setMode,
    onBack: () => back++,
  });
  const split = view.host.querySelector('[role="switch"]');
  assert.equal(split.checked, false);
  split.click();
  assert.equal(mode(), "split");
  assert.equal(split.checked, true);
  split.click();
  assert.equal(mode(), "unified");
  assert.equal(split.checked, false);
  assert.equal(view.host.querySelector("#change-review-back"), null);
  assert.equal(back, 0);
  view.dispose();
});

test("Change Review shows loading without an empty-state message", () => {
  const [loading, setLoading] = createSignal(true);
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    loading,
    repositories: () => [],
    summary: () => "Loading changes…",
    error: () => "",
    mode: () => "unified",
    onMode: () => {},
  });
  assert.match(view.host.textContent, /Loading changes/);
  assert.doesNotMatch(view.host.textContent, /no repositories to review/i);
  assert.doesNotMatch(view.host.textContent, /Select a changed file/i);
  setLoading(false);
  assert.match(view.host.textContent, /no repositories to review/i);
  view.dispose();
});

test("file navigator divider adjusts a shared width from either tab", () => {
  const [width, setWidth] = createSignal(285);
  const commits = [];
  const resize = (value, commit) => {
    setWidth(value);
    if (commit) commits.push(value);
  };
  const review = mount(ChangeReviewPanel, {
    visible: () => true,
    loading: () => false,
    repositories: () => [],
    summary: () => "",
    error: () => "",
    mode: () => "unified",
    onMode: () => {},
    navigatorWidth: width,
    onNavigatorResize: resize,
  });
  const docs = mount(DocsPane, {
    visible: () => true,
    files: () => [],
    selected: () => null,
    content: () => null,
    pageMessage: () => "",
    contentMessage: () => "Select a document",
    onSelect: () => {},
    navigatorWidth: width,
    onNavigatorResize: resize,
  });
  const reviewDivider = review.host.querySelector('[role="separator"]');
  const docsDivider = docs.host.querySelector('[role="separator"]');
  reviewDivider.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
  );
  assert.equal(reviewDivider.getAttribute("aria-valuenow"), "275");
  assert.equal(docsDivider.getAttribute("aria-valuenow"), "275");
  docsDivider.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  assert.deepEqual(commits, [275, 285]);
  review.dispose();
  docs.dispose();
});

test("Change Review keeps repository context without repeating the page title or checkout path", () => {
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    loading: () => false,
    repositories: () => [
      {
        name: "Repo",
        path: "/work/Repo",
        comparisonTarget: "origin/main",
        files: [],
      },
    ],
    summary: () => "1 repository · 0 files changed",
    error: () => "",
    mode: () => "unified",
    onMode: () => {},
    onBack: () => {},
  });
  const heading = view.host.querySelector(".change-review-current-repository");
  assert.match(heading.textContent, /Repo \(0\)/);
  assert.match(heading.getAttribute("aria-label"), /\/work\/Repo/);
  assert.doesNotMatch(
    view.host.textContent,
    /Change Review|\/work\/Repo|1 repository · 0 files changed/,
  );
  assert.match(view.host.textContent, /origin\/main/);
  view.dispose();
});

test("the toolbar follows the selected repository in a multi-repository review", () => {
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    repositories: () => [
      {
        name: "Alpha",
        path: "/alpha",
        comparisonTarget: "origin/main",
        files: [{ path: "a.txt", status: "M", diff: "" }],
      },
      {
        name: "Beta",
        path: "/beta",
        comparisonTarget: "local master",
        files: [{ path: "b.txt", status: "M", diff: "" }],
      },
    ],
    summary: () => "",
    error: () => "",
    mode: () => "unified",
    onMode: () => {},
    onBack: () => {},
  });
  const toolbar = view.host.querySelector(".change-review-current-repository");
  assert.match(toolbar.textContent, /Alpha.*origin\/main/);
  [...view.host.querySelectorAll("button")]
    .find((button) => button.textContent.includes("b.txt"))
    .click();
  assert.match(toolbar.textContent, /Beta.*local master/);
  view.dispose();
});

test("Change Review presents all files in a viewer without injecting file content", () => {
  const [mode, setMode] = createSignal("unified");
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    repositories: () => [
      {
        name: "Repo",
        path: "/repo",
        files: [
          {
            path: "a.txt",
            status: "changed",
            diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,4 @@\n same\n-old\n+new\n+<img src=x onerror=alert(1)>\n tail\n",
          },
        ],
      },
    ],
    summary: () => "",
    error: () => "",
    mode,
    onMode: setMode,
    onBack: () => {},
  });
  assert.ok(view.host.querySelector('[aria-label="All changed-file diffs"]'));
  assert.equal(view.host.querySelector("img"), null);
  const splitSwitch = view.host.querySelector('[role="switch"]');
  splitSwitch.click();
  assert.equal(splitSwitch.checked, true);
  assert.equal(view.host.querySelector("img"), null);
  view.dispose();
});

test("Change Review selects files in the navigator and keeps the all-files viewer", () => {
  const files = [
    {
      path: "src/first.txt",
      status: "changed",
      changeSource: "branch",
      diff: "",
    },
    {
      path: "src/second.txt",
      status: "M",
      changeSource: "workingTree",
      diff: "",
    },
  ];
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    repositories: () => [{ name: "Repo", path: "/repo", files }],
    summary: () => "",
    error: () => "",
    mode: () => "unified",
    onMode: () => {},
    onBack: () => {},
  });
  assert.equal(view.host.querySelector("details").open, true);
  assert.match(view.host.textContent, /Branch changes \(1\)/);
  assert.match(view.host.textContent, /Local changes \(1\)/);
  const second = [...view.host.querySelectorAll("button")].find((button) =>
    button.textContent.includes("second.txt"),
  );
  second.click();
  assert.equal(second.getAttribute("aria-current"), "true");
  assert.ok(view.host.querySelector('[aria-label="All changed-file diffs"]'));
  const search = view.host.querySelector('input[type="search"]');
  search.value = "first.txt";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(
    [...view.host.querySelectorAll("button")].some((button) =>
      button.textContent.includes("second.txt"),
    ),
    false,
  );
  view.dispose();
});

test("selecting another file does not request a replacement one-file diff", () => {
  const files = [
    {
      path: "first.txt",
      status: "M",
      diff: "--- a/first.txt\n+++ b/first.txt\n@@ -1 +1 @@\n-old\n+new\n",
    },
    {
      path: "second.txt",
      status: "M",
      diff: "--- a/second.txt\n+++ b/second.txt\n@@ -1 +1 @@\n-old\n+other\n",
    },
  ];
  const calls = [];
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    repositories: () => [
      { repositoryId: "repo", name: "Repo", path: "/repo", files },
    ],
    summary: () => "",
    error: () => "",
    mode: () => "unified",
    onMode: () => {},
    onBack: () => {},
    onFullDiff: (repo, path) => {
      calls.push([repo, path]);
      return Promise.resolve("unused");
    },
  });
  assert.deepEqual(calls, []);
  [...view.host.querySelectorAll("button")]
    .find((button) => button.textContent.includes("second.txt"))
    .click();
  assert.deepEqual(calls, []);
  assert.ok(view.host.querySelector('[aria-label="All changed-file diffs"]'));
  view.dispose();
});

test("review does not request full-file context for a multi-file review", async () => {
  const entry = {
    path: "file.txt",
    status: "M",
    diff: "--- a/file.txt\n+++ b/file.txt\n@@ -4 +4 @@\n-old\n+new\n",
  };
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    repositories: () => [
      { repositoryId: "repo", name: "Repo", path: "/repo", files: [entry] },
    ],
    summary: () => "",
    error: () => "",
    mode: () => "unified",
    onMode: () => {},
    onBack: () => {},
    onFullDiff: async () => {
      return "--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n context\n-old\n+new\n";
    },
  });
  await Promise.resolve();
  assert.ok(view.host.querySelector('[aria-label="All changed-file diffs"]'));
  assert.equal(view.host.textContent.includes("context"), false);
  assert.doesNotMatch(
    view.host.textContent,
    /Show full file context|Show changed sections/,
  );
  view.dispose();
});

test("the multi-file viewer does not turn a full-context failure into a review error", async () => {
  const entry = {
    path: "file.txt",
    status: "M",
    diff: "--- a/file.txt\n+++ b/file.txt\n@@ -4 +4 @@\n-old\n+new\n",
  };
  const view = mount(ChangeReviewPanel, {
    visible: () => true,
    repositories: () => [
      { repositoryId: "repo", name: "Repo", path: "/repo", files: [entry] },
    ],
    summary: () => "",
    error: () => "",
    mode: () => "unified",
    onMode: () => {},
    onBack: () => {},
    onFullDiff: async () => {
      throw new Error("size limit");
    },
  });
  await Promise.resolve();
  assert.equal(view.host.querySelector('[role="alert"]'), null);
  assert.ok(view.host.querySelector('[aria-label="All changed-file diffs"]'));
  view.dispose();
});

test("Docs source selection stays scoped to its repository and follows clicks", () => {
  const first = {
    repositoryId: "one",
    repositoryName: "One",
    path: "README.txt",
    contents: "First document",
  };
  const second = {
    repositoryId: "two",
    repositoryName: "Two",
    path: "README.txt",
    contents: "Second document",
  };
  const [selected, setSelected] = createSignal(first);
  const calls = [];
  const view = mount(DocsPane, {
    visible: () => true,
    files: () => [first, second],
    selected,
    content: () => first,
    contentMessage: () => "",
    pageMessage: () => "",
    onSelect: (file) => {
      calls.push(file);
      setSelected(file);
    },
  });
  const buttons = [...view.host.querySelectorAll("[data-doc-files] button")];
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].getAttribute("aria-current"), "true");
  assert.equal(
    buttons[1].getAttribute("aria-current"),
    null,
    "same path in another repository is not selected",
  );
  buttons[1].click();
  assert.deepEqual(calls, [second]);
  assert.equal(buttons[0].getAttribute("aria-current"), null);
  assert.equal(buttons[1].getAttribute("aria-current"), "true");
  view.dispose();
});

test("Docs puts the special ticket first with its icon and omits the repository heading", () => {
  const ticket = {
    path: "Ticket",
    repositoryId: null,
    repositoryName: null,
    isTicket: true,
  };
  const readme = {
    repositoryId: "one",
    repositoryName: "One",
    path: "README.md",
  };
  const view = mount(DocsPane, {
    visible: () => true,
    files: () => [ticket, readme],
    selected: () => ticket,
    content: () => ({
      path: "Ticket.md",
      contents:
        "---\ntitle: Sample ticket\nstatus: in_progress\nproject_label: Initiative\nopencode-status: running\nowner: Alice\n---\n# Sample ticket\n\n# Ticket body",
    }),
    ticketMetadata: () => ({
      title: "Sample ticket",
      status: "in_progress",
      projectLabel: "Initiative",
    }),
    pageMessage: () => "",
    contentMessage: () => "",
    onSelect: () => {},
  });
  const rows = [...view.host.querySelectorAll("[data-doc-files] button")];
  assert.equal(rows[0].textContent.trim(), "Ticket");
  assert.ok(rows[0].querySelector("svg"), "the Ticket row has an SVG icon");
  assert.equal(rows[0].getAttribute("aria-current"), "true");
  assert.equal(view.host.querySelector("[data-doc-files] h2"), null);
  assert.equal(rows[1].textContent.trim(), "README.md");
  const divider = view.host.querySelector("[data-doc-files] hr");
  assert.ok(
    divider,
    "a visual divider separates the ticket from repository files",
  );
  assert.equal(rows[0].closest("ul").nextElementSibling, divider);
  assert.ok(divider.nextElementSibling.contains(rows[1]));
  assert.equal(view.host.querySelector(".docs-content h2"), null);
  const ticketContent = view.host.querySelector(
    '[aria-label="Selected ticket: Sample ticket"]',
  );
  assert.ok(
    ticketContent,
    "Docs uses the shared Workspace ticket content component",
  );
  const ticketHeading = ticketContent.querySelector(":scope > header > h2");
  assert.equal(
    ticketHeading.querySelector('[aria-label="Status: In progress"]')
      ?.textContent,
    "In progress",
  );
  assert.equal(
    ticketHeading.querySelector("strong")?.textContent,
    "Sample ticket",
  );
  assert.match(ticketHeading.textContent, /Initiative\s*-\s*Sample ticket/);
  assert.equal(
    ticketContent.querySelector(".markdown h1")?.textContent,
    "Ticket body",
    "the body does not repeat its title heading",
  );
  const workspaceView = mount(WorkspaceTicketContent, {
    content: () =>
      "---\ntitle: Sample ticket\nstatus: in_progress\nproject_label: Initiative\nopencode-status: running\nowner: Alice\n---\n# Sample ticket\n\n# Ticket body",
    title: () => "Sample ticket",
    status: () => "in_progress",
    label: () => "Initiative",
  });
  const workspaceTicketContent = workspaceView.host.querySelector(
    '[aria-label="Selected ticket: Sample ticket"]',
  );
  assert.equal(
    ticketHeading.className,
    workspaceTicketContent.querySelector(":scope > header > h2").className,
  );
  const markdown = ticketContent.querySelector(":scope > .markdown");
  assert.equal(ticketContent.className, workspaceTicketContent.className);
  assert.equal(
    markdown.className,
    workspaceTicketContent.querySelector(":scope > .markdown").className,
  );
  assert.match(markdown.textContent, /Ticket body/);
  assert.ok(
    ticketContent.className && ticketContent.className !== "docs-content",
    "the shared ticket detail surface owns its styling, not the Docs pane",
  );
  const metadata = ticketContent.querySelector(
    ":scope > section[aria-label='Ticket metadata']",
  );
  assert.equal(ticketContent.querySelector(".docs-markdown"), null);
  assert.equal(
    metadata.previousElementSibling,
    markdown,
    "ticket metadata follows Markdown within the shared ticket detail surface",
  );
  assert.deepEqual(
    [
      ...ticketContent.querySelectorAll('[aria-label="Ticket metadata"] dt'),
    ].map((field) => field.textContent),
    ["title", "status", "owner"],
  );
  workspaceView.dispose();
  view.dispose();
});

test("workspace owner route omits removed options while terminal surface stays separate", () => {
  const values = {
    pendingPromptVisible: false,
    quickRequestBusy: false,
    modelBusy: false,
    modelDisabled: false,
    modelOptions: [],
    terminalRuntimeStartupFailed: false,
  };
  const props = new Proxy(
    {},
    { get: (_target, key) => () => values[key] ?? "" },
  );
  const view = mount(WorkspaceOwnerPanel, props);
  const terminalView = mount(TerminalSurface, {
    visible: () => true,
    sessionStatus: () => "",
    pendingInputs: () => null,
  });
  assert.equal(view.host.querySelector(".owner-management"), null);
  assert.equal(
    view.host.querySelector("summary").closest("#quick-request-form").hidden,
    true,
    "Quick Request model controls remain inside the hidden form",
  );
  assert.equal(view.host.querySelector("#attach-repository"), null);
  assert.equal(view.host.querySelector("#complete-workspace"), null);
  assert.equal(view.host.querySelector(".terminal-context"), null);
  assert.equal(view.host.querySelector("#terminal-views"), null);
  assert.equal(
    terminalView.host.querySelector(".terminal-card #terminal-views") !== null,
    true,
  );
  view.dispose();
  terminalView.dispose();
});
