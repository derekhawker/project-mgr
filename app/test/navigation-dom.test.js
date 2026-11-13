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
  export { WorkspaceTicketViewToggle } from ${JSON.stringify(resolve(root, "src/views/workspace/navigation/WorkspaceTicketViewToggle.jsx"))};
  export { QuickRequestList } from ${JSON.stringify(resolve(root, "src/views/quick-requests/QuickRequestList.jsx"))};
  export { DirectoriesNavigationButton } from ${JSON.stringify(resolve(root, "src/views/directories/DirectoriesNavigationButton.jsx"))};
  export { QuickRequestHistoryButton } from ${JSON.stringify(resolve(root, "src/views/quick-requests/QuickRequestHistoryButton.jsx"))};
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
  WorkspaceTicketViewToggle,
  QuickRequestList,
  DirectoriesNavigationButton,
  QuickRequestHistoryButton,
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
  assert.equal(menu.querySelector("summary").textContent, "New work");
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

test("workspace navigation filters and selects active regular workspaces", () => {
  const active = { id: "a", name: "Active", kind: "regular", status: "active" };
  const [selected, setSelected] = createSignal(null);
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces: [
        active,
        { id: "b", name: "Done", kind: "regular", status: "completed" },
        { id: "c", name: "Quick Requests", kind: "quick_request", status: "active" },
      ],
      workspaceRepositories: [
        { workspaceId: "a", verificationStatus: "verified" },
      ],
    }),
    busy: () => false,
    selected,
    onSelect: setSelected,
    viewMode: () => "grouped",
    onWork: () => {},
  });
  const buttons = view.host.querySelectorAll("button");
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent.trim(), "Active0");
  assert.equal(buttons[0].lastElementChild.textContent, "0");
  assert.equal(buttons[0].lastElementChild.getAttribute("aria-label"), "0 outstanding tickets");
  assert.equal(buttons[0].getAttribute("aria-current"), null);
  buttons[0].click();
  assert.equal(selected(), active);
  assert.equal(buttons[0].getAttribute("aria-current"), "page");
  view.dispose();
});

test("workspace refreshes update row data without replacing the hovered DOM node", () => {
  const workspace = (name) => ({
    id: "stable-id",
    name,
    kind: "regular",
    status: "active",
  });
  const initialData = { workspaces: [workspace("Before refresh")] };
  const [data, setData] = createSignal(initialData);
  const [selected, setSelected] = createSignal(null);
  const view = mount(WorkspaceNavigation, {
    data,
    busy: () => false,
    selected,
    onSelect: setSelected,
    viewMode: () => "grouped",
    onWork: () => {},
  });
  const row = view.host.querySelector("button");

  const refreshedWorkspace = workspace("After refresh");
  setData({
    workspaces: [refreshedWorkspace],
    workspaceTickets: {
      "stable-id": [
        { filename: "draft.md", title: "Draft", status: "draft" },
      ],
    },
  });

  assert.strictEqual(view.host.querySelector("button"), row);
  assert.equal(row.textContent.trim(), "After refresh1");
  row.click();
  assert.equal(selected(), refreshedWorkspace);
  view.dispose();
});

test("workspace tickets group, collapse, mark blocked, and flatten newest first", () => {
  const first = { id: "a", name: "Alpha", kind: "regular", status: "active" };
  const second = { id: "b", name: "Beta", kind: "regular", status: "active" };
  const [selected, setSelected] = createSignal(null);
  const [viewMode, setViewMode] = createSignal("grouped");
  const [currentTicket, setCurrentTicket] = createSignal(null);
  const worked = [];
  const view = mount(WorkspaceNavigation, {
    data: () => ({
      workspaces: [first, second],
      workspaceTickets: {
        a: [
          { filename: "blocked.md", title: "Blocked ticket", status: "blocked", modifiedAt: 30 },
          { filename: "active.md", title: "Active ticket", status: "in_progress", hasWorkSession: true, opencodeStatus: "idle", modifiedAt: 10 },
          { filename: "draft-session.md", title: "Draft with session", status: "draft", hasWorkSession: true, modifiedAt: 20 },
          { filename: "draft.md", title: "Draft ticket", status: "draft", hasWorkSession: false, modifiedAt: 15 },
          { filename: "done.md", title: "Done ticket", status: "done", modifiedAt: 5 },
          { filename: "cancelled.md", title: "Cancelled ticket", status: "cancelled", modifiedAt: 4 },
        ],
        b: [{ filename: "newest.md", title: "Newest ticket", status: "in_progress", modifiedAt: 40 }],
      },
    }),
    busy: () => false,
    selected,
    onSelect: setSelected,
    viewMode,
    isTicketCurrent: (_workspace, ticket) => currentTicket() === ticket.filename,
    onWork: (workspace, filename) => {
      setSelected(workspace);
      setCurrentTicket(filename);
      worked.push([workspace.id, filename]);
    },
  });

  const workspaceRows = [...view.host.querySelectorAll("button")].filter(
    (button) => button.firstElementChild?.tagName === "SPAN" &&
      (button.textContent.includes("Alpha") || button.textContent.includes("Beta")),
  );
  assert.equal(workspaceRows[0].lastElementChild.textContent, "4");
  assert.equal(workspaceRows[1].lastElementChild.textContent, "1");
  assert.equal(workspaceRows[0].lastElementChild.getAttribute("aria-label"), "4 outstanding tickets");

  assert.equal(view.host.querySelectorAll('[aria-expanded="true"]').length, 2);
  assert.equal(view.host.querySelectorAll('button[aria-label$="tickets"]').length, 2);
  assert.match(
    view.host.querySelector('button[aria-label="Collapse Alpha tickets"] svg').className,
    /muted/,
    "Workspace disclosure icon uses the shared muted icon style",
  );
  const idleIcon = view.host.querySelector('[aria-label="OpenCode session is idle"]');
  const blockedRow = [...view.host.querySelectorAll("button")].find((button) => button.textContent.includes("Blocked ticket"));
  assert.ok(
    [...view.host.querySelectorAll("button")].some((button) => button.textContent.includes("Draft with session")),
    "a draft with a saved work session appears in navigation",
  );
  assert.equal(
    [...view.host.querySelectorAll("button")].some((button) => button.textContent.includes("Draft ticket")),
    false,
    "a new draft without a saved work session stays out of navigation",
  );
  assertDecorativeIcon(blockedRow);
  assert.match(blockedRow.firstElementChild.className, /muted/);
  assert.match(blockedRow.firstElementChild.querySelector("path").getAttribute("d"), /M8 1\.5.*l5 5/);
  assert.ok(idleIcon);
  assert.equal(idleIcon.parentElement.firstElementChild, idleIcon, "the icon precedes the ticket title");
  assert.match(idleIcon.querySelector("svg path").getAttribute("d"), /a6\.5 6\.5.*v5m4-5v5$/, "idle status uses a circled pause icon");
  assert.match(idleIcon.parentElement.textContent, /Active ticket/);
  assert.equal(view.host.querySelectorAll('[aria-label="Ticket has saved session"]').length, 0);
  assert.ok(view.host.querySelector('[aria-label="Ticket has no work session"]'), "a missing work_session_id uses the caution icon");
  assert.equal(view.host.querySelectorAll("svg").length, 5);
  view.host.querySelector('button[aria-label="Collapse Alpha tickets"]').click();
  assert.doesNotMatch(view.host.textContent, /Blocked ticket|Active ticket|Draft with session|Draft ticket|Done ticket|Cancelled ticket/);
  assert.match(view.host.textContent, /Beta1Newest ticket/);
  assert.equal(selected(), null, "disclosure does not select a Workspace");
  assert.deepEqual(worked, [], "disclosure does not activate a ticket");
  [...view.host.querySelectorAll("button")].find((button) => button.textContent.includes("Alpha")).click();
  assert.equal(selected(), first);
  assert.equal(
    view.host.querySelector('button[aria-current="page"]')?.textContent.trim(),
    "Alpha4",
  );

  setViewMode("flat");
  assert.equal(view.host.querySelectorAll('button[aria-label$="tickets"]').length, 0);
  assert.deepEqual(
    [...view.host.querySelectorAll("li")].map((item) => item.textContent.trim()),
    ["Alpha4", "Beta1", "Tickets", "Newest ticket", "Blocked ticket", "Draft with session", "Active ticket"],
  );
  assert.equal(
    [...view.host.querySelectorAll("h3")].find((heading) => heading.textContent === "Tickets")?.textContent,
    "Tickets",
  );
  assert.equal(view.host.textContent.includes("Alpha ·"), false);
  assert.equal(view.host.querySelectorAll("svg").length, 3);
  [...view.host.querySelectorAll("button")].find((button) => button.textContent.includes("Newest ticket")).click();
  assert.deepEqual(worked, [["b", "newest.md"]]);
  assert.equal(
    view.host.querySelector('button[aria-current="page"]')?.textContent.trim(),
    "Newest ticket",
  );
  assert.equal(
    [...view.host.querySelectorAll("button[aria-current='page']")].some((button) => button.textContent.includes("Beta")),
    false,
    "the owning Workspace is not active while its ticket is active",
  );
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

test("Workspace view toggle is icon-only and names the available mode", () => {
  const [viewMode, setViewMode] = createSignal("grouped");
  const view = mount(WorkspaceTicketViewToggle, {
    viewMode,
    onToggle: () => setViewMode(viewMode() === "grouped" ? "flat" : "grouped"),
  });
  const button = view.host.querySelector("button");
  assert.equal(button.textContent.trim(), "");
  assert.equal(button.getAttribute("aria-label"), "Show flat ticket list");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assertDecorativeIcon(button);
  button.click();
  assert.equal(button.getAttribute("aria-label"), "Group tickets by Workspace");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  view.dispose();
});
