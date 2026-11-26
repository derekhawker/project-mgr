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
const temp = await mkdtemp(join(tmpdir(), "project-mgr-navigation-"));
const entry = join(temp, "entry.js");
await writeFile(
  entry,
  `
  export { render } from ${JSON.stringify(resolve(root, "node_modules/solid-js/web/dist/web.js"))};
  export { createComponent, createSignal } from ${JSON.stringify(resolve(root, "node_modules/solid-js/dist/solid.js"))};
  export { NewWorkMenu } from ${JSON.stringify(resolve(root, "src/features/new-work/NewWorkMenu.jsx"))};
  export { WorkspaceNavigation } from ${JSON.stringify(resolve(root, "src/views/workspace/navigation/WorkspaceNavigation.jsx"))};
  export { TicketSidebarTabs } from ${JSON.stringify(resolve(root, "src/views/workspace/navigation/TicketSidebarTabs.jsx"))};
  export { labelColorIndex, LABEL_COLOR_COUNT } from ${JSON.stringify(resolve(root, "src/views/workspace/navigation/ticketLabelColors.js"))};
  export { QuickRequestList } from ${JSON.stringify(resolve(root, "src/views/quick-requests/QuickRequestList.jsx"))};
  export { DirectoriesNavigationButton } from ${JSON.stringify(resolve(root, "src/views/directories/DirectoriesNavigationButton.jsx"))};
  export { QuickRequestHistoryButton } from ${JSON.stringify(resolve(root, "src/views/quick-requests/QuickRequestHistoryButton.jsx"))};
  export { ApplicationRoot } from ${JSON.stringify(resolve(root, "src/application/ApplicationRoot.jsx"))};
`,
);
try {
  await build({
    configFile: false,
    resolve: { alias: presentationAliases, dedupe: ["solid-js"] },
    root,
    plugins: [solid()],
    build: {
      outDir: join(temp, "dist"),
      lib: { entry, formats: ["es"], fileName: "navigation" },
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
  "MouseEvent",
]) {
  globalThis[key] =
    key === "window"
      ? window
      : key === "document"
        ? window.document
        : window[key];
}
const {
  render,
  createComponent,
  createSignal,
  NewWorkMenu,
  WorkspaceNavigation,
  TicketSidebarTabs,
  labelColorIndex,
  LABEL_COLOR_COUNT,
  QuickRequestList,
  DirectoriesNavigationButton,
  QuickRequestHistoryButton,
  ApplicationRoot,
} = await import(pathToFileURL(join(temp, "dist/navigation.js")));
function mount(Component, props) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => createComponent(Component, props), host);
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}
test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test("New work closes the native disclosure before reporting either choice", () => {
  const choices = [];
  const view = mount(NewWorkMenu, {
    onChoose: (type) =>
      choices.push([type, view.host.querySelector("details").open]),
  });
  const menu = view.host.querySelector("details");
  assert.equal(menu.querySelector("summary").textContent, "New work…");
  assertDecorativeIcon(menu.querySelector("summary"));
  assert.equal(
    menu.querySelector("[role=group]").getAttribute("aria-label"),
    "Choose work type",
  );
  for (const type of ["workspace", "quick_request"]) {
    menu.open = true;
    menu.querySelector(`[data-new-work-type="${type}"]`).click();
  }
  assert.deepEqual(choices, [
    ["workspace", false],
    ["quick_request", false],
  ]);
  view.dispose();
});

function assertDecorativeIcon(control) {
  const icon = control.querySelector("svg");
  assert.ok(
    icon,
    "Navigation controls use an inline SVG instead of a text/native marker",
  );
  assert.equal(icon.getAttribute("viewBox"), "0 0 16 16");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  assert.equal(icon.getAttribute("focusable"), "false");
  assert.ok(icon.querySelector("path").getAttribute("d"));
}

test("Directories uses a decorative SVG while retaining its label and action", () => {
  let opened = 0;
  const view = mount(DirectoriesNavigationButton, { onOpen: () => opened++ });
  const button = view.host.querySelector("button");
  assertDecorativeIcon(button);
  assert.equal(button.textContent.trim(), "Repos");
  assert.equal(button.getAttribute("aria-label"), "Open repositories");
  button.click();
  assert.equal(opened, 1);
  view.dispose();
});

test("Quick Requests uses a separate chevron button to open the full list", () => {
  let opened = 0;
  const view = mount(QuickRequestHistoryButton, { onShow: () => opened++ });
  const button = view.host.querySelector("#show-history");
  assert.equal(button.getAttribute("aria-label"), "Open all Quick Requests");
  assert.equal(button.textContent, "");
  assertDecorativeIcon(button);
  button.click();
  assert.equal(opened, 1);
  view.dispose();
});

test("workspace navigation filters out inactive Workspaces and exposes the current list busy state", () => {
  const [selected] = createSignal(null);
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces: [
        { id: "done", name: "Done", kind: "regular", status: "completed" },
        {
          id: "quick",
          name: "Quick Requests",
          kind: "quick_request",
          status: "active",
        },
      ],
    }),
    busy: () => true,
    selected,
    onSelect: () => {},
    viewMode: () => "recent",
    onWork: () => {},
  });
  assert.equal(
    view.host.querySelector('[role="tabpanel"]').getAttribute("aria-busy"),
    "true",
  );
  assert.match(view.host.textContent, /No recent tickets/);
  view.dispose();
});

test("workspace ticket updates render in Recent without retaining old grouped/flat controls", () => {
  const workspace = {
    id: "stable-id",
    name: "Alpha",
    kind: "regular",
    status: "active",
  };
  const [data, setData] = createSignal({
    workspaces: [workspace],
    workspaceTickets: { "stable-id": [] },
  });
  const view = mount(WorkspaceNavigation, {
    data,
    busy: () => false,
    selected: () => null,
    onSelect: () => {},
    viewMode: () => "recent",
    onWork: () => {},
  });
  setData({
    workspaces: [workspace],
    workspaceTickets: {
      "stable-id": [
        {
          filename: "draft.md",
          title: "Draft with session",
          status: "draft",
          hasWorkSession: true,
        },
        {
          filename: "draft-no-session.md",
          title: "New draft",
          status: "draft",
          hasWorkSession: false,
        },
      ],
    },
  });
  assert.match(view.host.textContent, /Draft with session/);
  assert.doesNotMatch(view.host.textContent, /New draft/);
  assert.equal(view.host.querySelectorAll('[aria-label$="tickets"]').length, 0);
  view.dispose();
});

test("Workspaces view groups visible tickets and Recent view sorts tickets newest first", () => {
  const workspaces = [
    { id: "a", name: "Alpha", kind: "regular", status: "active" },
    { id: "b", name: "Beta", kind: "regular", status: "active" },
  ];
  const tickets = {
    a: [
      {
        filename: "blocked.md",
        title: "Blocked",
        status: "blocked",
        modifiedAt: 30,
      },
      {
        filename: "old.md",
        title: "Older",
        status: "in_progress",
        modifiedAt: 10,
      },
      {
        filename: "cancelled.md",
        title: "Cancelled",
        status: "cancelled",
        hasWorkSession: true,
        modifiedAt: 50,
      },
    ],
    b: [
      {
        filename: "new.md",
        title: "Newest",
        status: "in_progress",
        modifiedAt: 40,
      },
    ],
  };
  const [viewMode, setViewMode] = createSignal("recent");
  const worked = [];
  const view = mount(WorkspaceNavigation, {
    data: () => ({ workspaces, workspaceTickets: tickets }),
    busy: () => false,
    selected: () => null,
    onSelect: () => {},
    viewMode,
    onWork: (...args) => worked.push(args),
  });
  assert.deepEqual(
    [...view.host.querySelectorAll("li")].map((item) =>
      item.textContent.trim(),
    ),
    ["NewestBeta", "BlockedAlpha", "OlderAlpha"],
  );
  assert.doesNotMatch(view.host.textContent, /Cancelled/);
  setViewMode("workspaces");
  assert.equal(
    view.host
      .querySelector('[role="tabpanel"]')
      .getAttribute("aria-labelledby"),
    "ticket-sidebar-workspaces",
  );
  assert.ok(
    [...view.host.querySelectorAll("button")].some((button) =>
      button.textContent.includes("Newest"),
    ),
  );
  [...view.host.querySelectorAll("button")]
    .find((button) => button.textContent.includes("Newest"))
    .click();
  assert.deepEqual(worked, [[workspaces[1], "new.md"]]);
  view.dispose();
});

test("Workspaces retains the existing owner groups for singly used labels", () => {
  const workspace = {
    id: "active-owner",
    name: "Active Owner",
    kind: "regular",
    status: "active",
  };
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces: [workspace],
      workspaceTickets: {
        "active-owner": [
          {
            filename: "active.md",
            title: "Visible ticket",
            status: "in_progress",
            projectLabel: "Rollout",
          },
        ],
      },
    }),
    busy: () => false,
    selected: () => null,
    viewMode: () => "workspaces",
    onSelect: () => {},
    onWork: () => {},
  });
  assert.ok(
    [...view.host.querySelectorAll("button")].some((button) =>
      button.textContent.includes("Visible ticket"),
    ),
  );
  assert.ok(
    [...view.host.querySelectorAll("button")].some((button) =>
      button.textContent.includes("Active Owner"),
    ),
  );
  view.dispose();
});

test("Workspaces renders shared labels as headings above owner-identifying rows", () => {
  const workspaces = [
    { id: "a", name: "Alpha", kind: "regular", status: "active" },
    { id: "b", name: "Beta", kind: "regular", status: "active" },
  ];
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces,
      workspaceTickets: {
        a: [
          {
            filename: "a.md",
            title: "Alpha ticket",
            status: "in_progress",
            projectLabel: "Shared label",
          },
        ],
        b: [
          {
            filename: "b.md",
            title: "Beta ticket",
            status: "blocked",
            projectLabel: "Shared label",
          },
        ],
      },
    }),
    busy: () => false,
    selected: () => null,
    viewMode: () => "workspaces",
    onSelect: () => {},
    onWork: () => {},
  });

  assert.equal(view.host.querySelector("h3")?.textContent, "Shared label");
  assert.match(view.host.textContent, /Alpha.*Alpha ticket/);
  assert.match(view.host.textContent, /Beta.*Beta ticket/);
  assert.equal(
    view.host.querySelector("h3").closest("button"),
    null,
    "shared label heading is presentation, not a navigation control",
  );
  view.dispose();
});

test("ticket context menu is limited to ticket rows and invokes label editing", async () => {
  const workspace = {
    id: "a",
    name: "Alpha Repo",
    kind: "regular",
    status: "active",
  };
  const ticket = {
    filename: "one.md",
    title: "First",
    status: "in_progress",
    projectLabel: "Launch",
  };
  let edited;
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces: [workspace],
      workspaceTickets: { a: [ticket] },
    }),
    busy: () => false,
    selected: () => null,
    viewMode: () => "workspaces",
    onSelect: () => {},
    onWork: () => {},
    onChangeLabel: (...args) => {
      edited = args;
    },
  });
  const row = [...view.host.querySelectorAll("button")].find((button) =>
    button.textContent.includes("First"),
  );
  const contextMenu = new Event("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  row.dispatchEvent(contextMenu);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(contextMenu.defaultPrevented, true);
  assert.equal(
    view.host.querySelector('[role="menu"] [role="menuitem"]').textContent,
    "Change label…",
  );
  view.host.querySelector('[role="menuitem"]').click();
  assert.deepEqual(edited, [workspace, ticket]);
  view.dispose();
});

test("Quick Request navigation item exposes its selected state and opens the record", () => {
  const record = { task: { id: "request-1" }, prompt: "A request" };
  const [selectedId] = createSignal(record.task.id);
  let opened;
  const view = mount(QuickRequestList, {
    records: () => [record],
    history: () => false,
    query: () => "",
    selectedId,
    onOpen: (value) => (opened = value),
  });
  const item = view.host.querySelector('button[aria-current="page"]');
  assert.equal(item.textContent.trim(), "A request");
  item.click();
  assert.equal(opened, record);
  view.dispose();
});

test("Quick Request refreshes preserve the positional row and update click data", () => {
  const [records, setRecords] = createSignal([
    { task: { id: "request-1" }, prompt: "Before refresh" },
  ]);
  const [selectedId] = createSignal(null);
  let opened;
  const view = mount(QuickRequestList, {
    records,
    history: () => false,
    query: () => "",
    selectedId,
    onOpen: (value) => (opened = value),
  });
  const row = view.host.querySelector("button");
  const refreshedRecord = {
    task: { id: "request-1" },
    prompt: "After refresh",
  };

  setRecords([refreshedRecord]);

  assert.strictEqual(view.host.querySelector("button"), row);
  assert.equal(row.textContent.trim(), "After refresh");
  row.click();
  assert.equal(opened, refreshedRecord);
  view.dispose();
});

test("label colors use a stable 20-color palette and normalize case and whitespace", () => {
  assert.equal(LABEL_COLOR_COUNT, 20);
  assert.ok(Number.isInteger(labelColorIndex("Launch")));
  assert.ok(labelColorIndex("Launch") >= 0 && labelColorIndex("Launch") < 20);
  assert.equal(labelColorIndex("  Launch  "), labelColorIndex("launch"));
  assert.equal(
    labelColorIndex("Multiple   Words"),
    labelColorIndex(" multiple\nwords "),
  );
  assert.equal(labelColorIndex(null), labelColorIndex(""));
  assert.equal(labelColorIndex("Release"), labelColorIndex("release"));
});

test("Ticket Sidebar tabs render accessible selection and report selected view", () => {
  const [value, setValue] = createSignal("recent");
  const view = mount(TicketSidebarTabs, { value, onChange: setValue });
  const tablist = view.host.querySelector('[role="tablist"]');
  const tabs = [...view.host.querySelectorAll('[role="tab"]')];
  assert.equal(tablist.getAttribute("aria-label"), "Ticket Sidebar views");
  assert.deepEqual(
    tabs.map((tab) => tab.textContent.trim()),
    ["Recent", "Workspaces"],
  );
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].getAttribute("aria-selected"), "false");
  assert.equal(tabs[1].getAttribute("aria-controls"), "ticket-sidebar-list");
  tabs[1].click();
  assert.equal(value(), "workspaces");
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  view.dispose();
});

test("Recent context is static; Workspaces keeps shared-label headings and Workspace rows", () => {
  const workspaces = [
    { id: "one", name: "Alpha", kind: "regular", status: "active" },
    { id: "two", name: "Beta", kind: "regular", status: "active" },
  ];
  const tickets = {
    one: [
      {
        filename: "ticket.md",
        title: "Ship feature",
        status: "in_progress",
        projectLabel: "Launch",
      },
      {
        filename: "other.md",
        title: "Other work",
        status: "blocked",
        projectLabel: "Launch",
      },
      { filename: "unlabelled.md", title: "No label", status: "in_progress" },
      {
        filename: "private.md",
        title: "Private work",
        status: "draft",
        hasWorkSession: true,
      },
    ],
    two: [
      {
        filename: "beta.md",
        title: "Beta work",
        status: "in_progress",
        projectLabel: "Launch",
      },
    ],
  };
  const [viewMode, setViewMode] = createSignal("recent");
  const worked = [];
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces,
      workspaceTickets: tickets,
    }),
    busy: () => false,
    selected: () => null,
    onSelect: () => {},
    viewMode,
    onWork: (...args) => worked.push(args),
  });
  assert.equal(
    view.host
      .querySelector('[role="tabpanel"]')
      .getAttribute("aria-labelledby"),
    "ticket-sidebar-recent",
  );
  assert.match(view.host.textContent, /Ship feature/);
  assert.match(view.host.textContent, /Launch/);
  const recentTag = [...view.host.querySelectorAll("span")].find(
    (element) => element.textContent.trim() === "Launch",
  );
  assert.ok(recentTag);
  assert.equal(recentTag.closest("button"), null);
  const recentWorkspaceContext = [...view.host.querySelectorAll("span")].find(
    (element) =>
      element.textContent.trim() === "Alpha" && element.hasAttribute("title"),
  );
  assert.ok(recentWorkspaceContext, "Recent identifies the owning Workspace");
  assert.equal(recentWorkspaceContext.closest("button"), null);
  assert.equal(recentTag.getAttribute("title"), "Launch");
  assert.equal(
    recentTag.getAttribute("role"),
    null,
    "the label is not an interactive control",
  );
  setViewMode("workspaces");
  assert.equal(
    view.host
      .querySelector('[role="tabpanel"]')
      .getAttribute("aria-labelledby"),
    "ticket-sidebar-workspaces",
  );
  assert.equal(view.host.querySelector("h3")?.textContent, "Launch");
  assert.equal(view.host.querySelectorAll("h3").length, 1);
  const workspaceRow = [...view.host.querySelectorAll("button")].find(
    (button) =>
      button.textContent.includes("Alpha") &&
      button.querySelector('[aria-label="4 outstanding tickets"]'),
  );
  assert.ok(workspaceRow, "the established Workspace row remains available");
  assert.equal(
    workspaceRow.querySelector('[aria-label="4 outstanding tickets"]')
      ?.textContent,
    "4",
  );
  const disclosure = view.host.querySelector(
    '[aria-label="Collapse Alpha tickets"]',
  );
  assert.ok(
    disclosure,
    "ticket-bearing Workspace rows retain their disclosure",
  );
  disclosure.click();
  assert.equal(
    view.host
      .querySelector('[aria-label="Expand Alpha tickets"]')
      ?.getAttribute("aria-expanded"),
    "false",
  );
  assert.doesNotMatch(view.host.textContent, /Private work/);
  workspaceRow.click();
  assert.deepEqual(worked, []);
  view.dispose();
});

test("Workspaces includes done and archived tickets and routes them to the matching browser list", () => {
  const workspace = {
    id: "one",
    name: "Alpha",
    kind: "regular",
    status: "active",
  };
  const tickets = [
    {
      filename: "done.md",
      title: "Done ticket",
      status: "done",
      archived: false,
      projectLabel: "Launch",
    },
    {
      filename: "cancelled.md",
      title: "Cancelled ticket",
      status: "cancelled",
      archived: true,
      projectLabel: "Launch",
    },
    {
      filename: "active.md",
      title: "Active ticket",
      status: "in_progress",
      archived: false,
      projectLabel: "Launch",
    },
  ];
  const opened = [];
  const [viewMode] = createSignal("workspaces");
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces: [workspace],
      workspaceTickets: { one: tickets },
    }),
    busy: () => false,
    selected: () => null,
    viewMode,
    onSelect: () => {},
    onSelectTicket: (...args) => opened.push(args),
    onWork: () =>
      assert.fail("Workspaces historical tickets must open the browser"),
  });
  const ticketButton = (title) =>
    [...view.host.querySelectorAll("button")].find((button) =>
      button.textContent.includes(title),
    );
  assert.match(view.host.textContent, /Done ticket/);
  assert.match(view.host.textContent, /Cancelled ticket/);
  ticketButton("Done ticket").click();
  ticketButton("Cancelled ticket").click();
  assert.deepEqual(opened, [
    [workspace, tickets[0]],
    [workspace, tickets[1]],
  ]);
  view.dispose();
});

test("Workspaces includes tickets owned by completed regular Workspaces", () => {
  const workspace = {
    id: "completed-owner",
    name: "Completed owner",
    kind: "regular",
    status: "completed",
  };
  const [viewMode] = createSignal("workspaces");
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces: [workspace],
      workspaceTickets: {
        "completed-owner": [
          {
            filename: "old.md",
            title: "Retained historical ticket",
            status: "done",
            modifiedAt: 1,
            archived: false,
          },
        ],
      },
    }),
    busy: () => false,
    selected: () => null,
    viewMode,
    onSelect: () => {},
    onSelectTicket: () => {},
    onWork: () => {},
  });

  assert.match(view.host.textContent, /Retained historical ticket/);
  view.dispose();
});
