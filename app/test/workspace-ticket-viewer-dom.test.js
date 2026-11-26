import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  export { WorkspaceTicketViewer } from ${JSON.stringify(resolve(root, "src/views/workspace/tickets/WorkspaceTicketViewer.jsx"))};
  export { CreateTicketIdeaModal } from ${JSON.stringify(resolve(root, "src/views/workspace/tickets/CreateTicketIdeaModal.jsx"))};
  export { DeleteWorkspaceModal } from ${JSON.stringify(resolve(root, "src/views/workspace/tickets/DeleteWorkspaceModal.jsx"))};
  export { ActionMenu } from ${JSON.stringify(resolve(root, "packages/ui-lib/ActionMenu.jsx"))};
`,
);
try {
  await build({
    configFile: false,
    resolve: { alias: presentationAliases, dedupe: ["solid-js"] },
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
  WorkspaceTicketViewer,
  CreateTicketIdeaModal,
  DeleteWorkspaceModal,
  ActionMenu,
} = await import(pathToFileURL(join(temp, "out/test.js")));

function mount(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => createComponent(WorkspaceTicketViewer, props),
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

function mountIdeaModal(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => createComponent(CreateTicketIdeaModal, props),
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

function mountDeleteWorkspaceModal(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => createComponent(DeleteWorkspaceModal, props),
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

const longContent = "x".repeat(1300);
const ticketHeadingStyles = await readFile(
  resolve(root, "src/views/workspace/tickets/WorkspaceTicketViewer.module.css"),
  "utf8",
);
const statusBadgeStyles = await readFile(
  resolve(root, "src/views/workspace/tickets/TicketStatusBadge.module.css"),
  "utf8",
);
const tickets = [
  {
    filename: "one.md",
    title: "First",
    status: "draft",
    modifiedAt: 100,
    content: `---\ntitle: First\nstatus: draft\nproject_label: Example Project\nowner: Alice\n---\n# First\n\n${longContent}`,
  },
  {
    filename: "one-session.md",
    title: "Draft with session",
    status: "draft",
    hasWorkSession: true,
    opencodeStatus: "ready_for_review",
    modifiedAt: 90,
    content:
      "---\ntitle: Draft with session\nstatus: draft\nwork_session_id: ses-draft\nopencode-status: ready_for_review\n---\nDraft body",
  },
  {
    filename: "two.md",
    title: "Second",
    status: "blocked",
    hasWorkSession: false,
    opencodeStatus: "waiting_for_input",
    modifiedAt: 200,
    content:
      "---\ntitle: Second\nstatus: blocked\nopencode-status: waiting_for_input\n---\nSecond body",
  },
  {
    filename: "three.md",
    title: "Third",
    status: "in_progress",
    hasWorkSession: true,
    opencodeStatus: "idle",
    modifiedAt: 50,
    content:
      "---\ntitle: Third\nstatus: in_progress\nwork_session_id: ses-three\nopencode-status: idle\n---\nThird body",
  },
  {
    filename: "four.md",
    title: "Fourth",
    status: "in_progress",
    hasWorkSession: true,
    opencodeStatus: "unknown",
    modifiedAt: 60,
    content:
      "---\ntitle: Fourth\nstatus: in_progress\nwork_session_id: ses-four\nopencode-status: unknown\n---\nFourth body",
  },
  {
    filename: "five.md",
    title: "Fifth",
    status: "in_progress",
    hasWorkSession: false,
    modifiedAt: 40,
    content: "---\ntitle: Fifth\nstatus: in_progress\n---\nFifth body",
  },
];

test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
});

test("portaled menus expose unique controls and support reverse tab from the next control", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => {
    const container = document.createElement("div");
    for (let i = 0; i < 2; i++) {
      const action = document.createElement("button");
      action.textContent = `Action ${i}`;
      container.append(
        createComponent(ActionMenu, {
          portal: true,
          label: `Menu ${i}`,
          children: action,
        }),
      );
      const next = document.createElement("button");
      next.textContent = `Next ${i}`;
      container.append(next);
    }
    return container;
  }, host);
  const originalRects = window.HTMLElement.prototype.getClientRects;
  window.HTMLElement.prototype.getClientRects = () => [1];
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const triggers = [...host.querySelectorAll("summary")];
    const ids = triggers.map((trigger) =>
      trigger.getAttribute("aria-controls"),
    );
    assert.ok(ids.every(Boolean));
    assert.notEqual(ids[0], ids[1]);
    assert.ok(ids.every((id) => document.getElementById(id)));
    triggers[0].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const next = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Next 0",
    );
    next.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    next.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(document.activeElement.textContent, "Action 0");
  } finally {
    window.HTMLElement.prototype.getClientRects = originalRects;
    dispose();
    host.remove();
  }
});

test("multiple portaled menus honor earlier Tab handling without skipping a trigger", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => {
    const container = document.createElement("div");
    for (let index = 0; index < 2; index++) {
      const action = document.createElement("button");
      action.textContent = `Action ${index}`;
      container.append(
        createComponent(ActionMenu, {
          portal: true,
          label: `Menu ${index}`,
          children: action,
        }),
      );
    }
    return container;
  }, host);
  const originalRects = window.HTMLElement.prototype.getClientRects;
  window.HTMLElement.prototype.getClientRects = () => [1];
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [trigger, nextTrigger] = host.querySelectorAll("summary");
    // Happy DOM does not give native summary elements their browser tab index.
    trigger.tabIndex = 0;
    nextTrigger.tabIndex = 0;
    trigger.click();
    nextTrigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    document
      .querySelector(`#${trigger.getAttribute("aria-controls")} button`)
      .focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.activeElement.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.ok(
      document.activeElement === nextTrigger,
      `second menu does not move focus past its trigger; focused ${document.activeElement?.outerHTML.slice(0, 250)}`,
    );
  } finally {
    window.HTMLElement.prototype.getClientRects = originalRects;
    dispose();
    host.remove();
  }
});

test("selecting a focused portaled action restores its trigger unless the action moves focus", async () => {
  const elsewhere = document.createElement("button");
  elsewhere.textContent = "Elsewhere";
  document.body.append(elsewhere);
  const [moveFocus, setMoveFocus] = createSignal(false);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => {
    const action = document.createElement("button");
    action.textContent = "Select";
    action.onclick = () => {
      if (moveFocus()) elsewhere.focus();
    };
    return createComponent(ActionMenu, {
      portal: true,
      label: "Menu",
      children: action,
    });
  }, host);
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = host.querySelector("summary");
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    let action = document.querySelector('[aria-label="Menu"] button');
    action.focus();
    action.click();
    await Promise.resolve();
    assert.equal(document.activeElement, trigger);
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    action = document.querySelector('[aria-label="Menu"] button');
    action.focus();
    setMoveFocus(true);
    action.click();
    await Promise.resolve();
    assert.equal(
      document.activeElement,
      elsewhere,
      "menu does not steal focus moved by the action",
    );
  } finally {
    dispose();
    host.remove();
    elsewhere.remove();
  }
});

test("ticket actions stay open after clicking the trigger and allow cancellation", async () => {
  const calls = [];
  const view = mount({
    tickets: () => [tickets[0]],
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
    onCancel: (filename) => calls.push(filename),
  });
  try {
    const trigger = view.host.querySelector(
      'summary[aria-label="Actions for ticket: First"]',
    );
    const disclosure = trigger.closest("details");
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      disclosure.open,
      true,
      "clicking Actions leaves the menu open",
    );
    const cancel = document.querySelector(
      '[aria-label="Ticket actions: First"] button',
    );
    assert.equal(cancel.textContent.trim(), "Cancel ticket");
    cancel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    assert.equal(
      disclosure.open,
      true,
      "pressing an action does not dismiss its menu",
    );
    cancel.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    cancel.click();
    assert.deepEqual(calls, ["one.md"]);
    assert.equal(disclosure.open, false);
  } finally {
    view.dispose();
  }
});

test("ticket actions remain open and use refreshed ticket data after a list refresh", async () => {
  const [rows, setRows] = createSignal([{ ...tickets[0] }]);
  const calls = [];
  const view = mount({
    tickets: rows,
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
    onCancel: (filename) => calls.push(filename),
  });
  try {
    view.host
      .querySelector('summary[aria-label="Actions for ticket: First"]')
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setRows([{ ...tickets[0], title: "Updated title" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = view.host.querySelector(
      'summary[aria-label="Actions for ticket: Updated title"]',
    );
    assert.ok(trigger, "the refreshed title is displayed");
    assert.equal(
      trigger.closest("details").open,
      true,
      "refresh does not close the open menu",
    );
    document
      .querySelector('[aria-label="Ticket actions: Updated title"] button')
      .click();
    assert.deepEqual(calls, ["one.md"]);
    assert.equal(trigger.closest("details").open, false);
  } finally {
    view.dispose();
  }
});

test("ticket actions survive an explicit refresh with a loading transition", async () => {
  const [rows, setRows] = createSignal([{ ...tickets[0] }]);
  const [loading, setLoading] = createSignal(false);
  const calls = [];
  const view = mount({
    tickets: rows,
    selectedFilename: () => null,
    loading,
    error: () => "",
    onCancel: (filename) => calls.push(filename),
  });
  try {
    view.host
      .querySelector('summary[aria-label="Actions for ticket: First"]')
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    setLoading(true);
    setRows([{ ...tickets[0], title: "Refreshed title" }]);
    setLoading(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = view.host.querySelector(
      'summary[aria-label="Actions for ticket: Refreshed title"]',
    );
    assert.ok(trigger);
    assert.equal(
      trigger.closest("details").open,
      true,
      "explicit refresh keeps the menu open",
    );
    document
      .querySelector('[aria-label="Ticket actions: Refreshed title"] button')
      .click();
    assert.deepEqual(calls, ["one.md"]);
  } finally {
    view.dispose();
  }
});

test("Escape dismisses portaled ticket actions and returns focus to the trigger", async () => {
  const view = mount({
    tickets: () => [tickets[0]],
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
    onCancel: () => {},
  });
  try {
    const trigger = view.host.querySelector(
      'summary[aria-label="Actions for ticket: First"]',
    );
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const action = document.querySelector(
      '[aria-label="Ticket actions: First"] button',
    );
    action.focus();
    assert.equal(document.activeElement, action);
    action.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    assert.equal(trigger.closest("details").open, false);
    assert.equal(document.activeElement, trigger);
  } finally {
    view.dispose();
  }
});

test("sort and model menus remain operable when ticket rows refresh", async () => {
  const [rows, setRows] = createSignal([{ ...tickets[0] }]);
  const changes = [];
  const view = mount({
    tickets: rows,
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
    selectedModel: () => "one",
    modelBusy: () => false,
    modelOptions: () => [
      { value: "one", label: "Model one" },
      { value: "two", label: "Model two" },
    ],
    onModelChange: (value) => changes.push(value),
  });
  try {
    const refresh = () => setRows(rows().map((ticket) => ({ ...ticket })));
    const sort = view.host.querySelector('summary[aria-label="Sort: Status"]');
    sort.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    refresh();
    assert.equal(sort.closest("details").open, true);
    [...view.host.querySelectorAll('[aria-label="Sort tickets"] button')]
      .find((button) => button.textContent.trim() === "Title")
      .click();
    assert.ok(view.host.querySelector('summary[aria-label="Sort: Title"]'));
    const model = view.host.querySelector('summary[aria-label="Model one"]');
    model.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    refresh();
    assert.equal(model.closest("details").open, true);
    [...view.host.querySelectorAll('[aria-label="Default Model"] button')]
      .find((button) => button.textContent.trim() === "Model two")
      .click();
    assert.deepEqual(changes, ["two"]);
  } finally {
    view.dispose();
  }
});

test("an open ticket menu closes when the ticket becomes done", async () => {
  const [rows, setRows] = createSignal([{ ...tickets[0] }]);
  const view = mount({
    tickets: rows,
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
  });
  try {
    const trigger = view.host.querySelector(
      'summary[aria-label="Actions for ticket: First"]',
    );
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(trigger.closest("details").open, true);
    setRows([{ ...tickets[0], status: "done" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(trigger.closest("details").open, false);
    assert.equal(trigger.getAttribute("aria-disabled"), "true");
  } finally {
    view.dispose();
  }
});

test("ticket actions follow archive location and block cancellation while a session is active", async () => {
  const calls = [];
  const [archived, setArchived] = createSignal(false);
  const [rows, setRows] = createSignal([
    {
      filename: "active.md",
      title: "Active",
      status: "in_progress",
      hasWorkSession: true,
      opencodeStatus: "running",
      modifiedAt: 100,
    },
    {
      filename: "cancelled.md",
      title: "Cancelled",
      status: "cancelled",
      modifiedAt: 90,
    },
  ]);
  const view = mount({
    tickets: rows,
    archived,
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
    onCancel: (filename) => calls.push(["cancel", filename]),
    onUncancel: (filename) => calls.push(["uncancel", filename]),
  });
  try {
    await Promise.resolve();
    const actions = (title) =>
      document.querySelector(`[aria-label="Ticket actions: ${title}"]`);
    const active = actions("Active").querySelector("button");
    assert.equal(active.disabled, true);
    assert.match(active.textContent, /session active/i);
    const misplaced = actions("Cancelled").querySelector("button");
    assert.equal(misplaced.textContent.trim(), "Cancel ticket");
    misplaced.click();
    setArchived(true);
    setRows([
      {
        filename: "done.md",
        title: "Done",
        status: "done",
        modifiedAt: 100,
        hasWorkSession: true,
        opencodeStatus: "running",
      },
      {
        filename: "cancelled.md",
        title: "Cancelled",
        status: "cancelled",
        modifiedAt: 90,
      },
    ]);
    await Promise.resolve();
    const archivedDone = view.host.querySelector(
      'summary[aria-label="Actions for ticket: Done"]',
    );
    assert.equal(archivedDone.getAttribute("aria-disabled"), "true");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    archivedDone.dispatchEvent(click);
    assert.equal(click.defaultPrevented, true);
    actions("Cancelled").querySelector("button").click();
    assert.deepEqual(calls, [
      ["cancel", "cancelled.md"],
      ["uncancel", "cancelled.md"],
    ]);
  } finally {
    view.dispose();
  }
});

test("ticket viewer exposes the remembered OpenCode default model selector", () => {
  const calls = [];
  const selection = JSON.stringify({ providerId: "fixture", id: "model" });
  const view = mount({
    workspaceName: () => "Example Workspace",
    tickets: () => [],
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
    selectedModel: () => selection,
    modelBusy: () => false,
    modelError: () => "",
    modelOptions: () => [
      { value: selection, label: "Fixture model" },
      {
        value: JSON.stringify({ providerId: "fixture", id: "other" }),
        label: "Other model",
      },
    ],
    onModelChange: (value) => calls.push(value),
  });
  try {
    const trigger = view.host.querySelector(
      'summary[aria-label="Fixture model"]',
    );
    assert.ok(trigger);
    assert.match(view.host.textContent, /Default Model/);
    trigger.click();
    assert.ok(
      view.host.querySelector(
        '[role="group"] button[aria-pressed="true"] svg[aria-hidden="true"]',
      ),
    );
    view.host
      .querySelector('[role="group"] button[aria-pressed="false"]')
      .click();
    assert.deepEqual(calls, [
      JSON.stringify({ providerId: "fixture", id: "other" }),
    ]);
  } finally {
    view.dispose();
  }
});

test("ticket viewer keeps workspace tools available with no selected ticket", () => {
  const view = mount({
    workspaceName: () => "Example Workspace",
    tickets: () => [],
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
    toolsMenu: () => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Tools";
      return button;
    },
  });
  try {
    assert.match(view.host.textContent, /No active tickets/);
    assert.ok(
      [...view.host.querySelectorAll("button")].some(
        (button) => button.textContent === "Tools",
      ),
    );
    const toolbarButtons = [...view.host.querySelectorAll("header button")];
    const createTrigger = toolbarButtons.find((button) =>
      button.textContent.trim().startsWith("Create ticket"),
    );
    const deleteTrigger = toolbarButtons.find(
      (button) => button.textContent.trim() === "Delete workspace…",
    );
    assert.equal(createTrigger.textContent.trim(), "Create ticket…");
    assert.ok(
      deleteTrigger,
      "the neutral delete trigger is in the ticket toolbar",
    );
    assert.equal(createTrigger.parentElement, deleteTrigger.parentElement);
    assert.ok(
      createTrigger.compareDocumentPosition(deleteTrigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
    assert.equal(
      deleteTrigger.closest("header")?.contains(deleteTrigger),
      true,
    );
    assert.doesNotMatch(deleteTrigger.className, /danger/);
  } finally {
    view.dispose();
  }
});

test("ticket idea modal marks both current steps, keeps failed edits open, and closes after success", async () => {
  let failures = 1;
  const proposals = [];
  const creations = [];
  const view = mountIdeaModal({
    onPropose: async (idea) => {
      proposals.push(idea);
      return {
        title: "Proposed title",
        body: "# Proposed title\n\nOriginal body",
      };
    },
    onCreate: async (title, body, startInvestigation) => {
      creations.push([title, body, startInvestigation]);
      if (failures-- > 0) throw new Error("disk unavailable");
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    view.host.querySelector("button").click();
    assert.equal(
      view.host.querySelectorAll('[aria-label="Ticket creation steps"] li')
        .length,
      2,
    );
    assert.equal(
      view.host.querySelector('[aria-current="step"]').firstElementChild
        .textContent,
      "1",
    );
    assert.deepEqual(
      [
        ...view.host.querySelectorAll(
          '[aria-label="Ticket creation steps"] li',
        ),
      ].map((item) => item.lastElementChild.textContent),
      ["Description", "Review"],
      "both step labels remain visible on the description step",
    );
    const idea = view.host.querySelector("#ticket-idea");
    idea.value = "Capture onboarding pain";
    idea.dispatchEvent(new Event("input", { bubbles: true }));
    view.host.querySelector('button[type="submit"]').click();
    await flush();
    assert.deepEqual(proposals, ["Capture onboarding pain"]);
    assert.deepEqual(creations, [], "proposal review does not create a file");
    assert.equal(
      view.host.querySelector('[aria-current="step"]').firstElementChild
        .textContent,
      "2",
    );
    assert.deepEqual(
      [
        ...view.host.querySelectorAll(
          '[aria-label="Ticket creation steps"] li',
        ),
      ].map((item) => item.lastElementChild.textContent),
      ["Description", "Review"],
      "both step labels remain visible on the review step",
    );
    assert.equal(
      view.host.querySelectorAll('[aria-label="Ticket creation steps"] li')
        .length,
      2,
    );
    const title = view.host.querySelector("#ticket-title");
    const body = view.host.querySelector("#ticket-body");
    title.value = "Edited title";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    body.value = "Edited Markdown";
    body.dispatchEvent(new Event("input", { bubbles: true }));
    view.host.querySelector("dialog footer button:last-child").click();
    await flush();
    assert.equal(view.host.querySelector("dialog").open, true);
    assert.equal(
      view.host.querySelector("#ticket-title").value,
      "Edited title",
    );
    assert.equal(
      view.host.querySelector("#ticket-body").value,
      "Edited Markdown",
    );
    assert.match(
      view.host.querySelector('[role="alert"]').textContent,
      /Your edits are still here/,
    );
    view.host.querySelector("dialog footer button:last-child").click();
    await flush();
    assert.equal(view.host.querySelector("dialog").open, false);
    assert.deepEqual(creations, [
      ["Edited title", "Edited Markdown", false],
      ["Edited title", "Edited Markdown", false],
    ]);
    view.host.querySelector("button").click();
    view.host
      .querySelector('button[type="submit"]')
      .closest("dialog")
      .querySelector('button[aria-label="Close dialog"]')
      .click();
    assert.equal(view.host.querySelector("dialog").open, false);
    assert.equal(creations.length, 2, "cancel does not create a ticket");
    assert.equal(proposals.length, 1, "cancel does not start another proposal");
  } finally {
    view.dispose();
  }
});

test("workspace deletion always warns, archives active tickets, and recovers from failures", async () => {
  let archiveFailures = 1;
  let deleteFailures = 1;
  const calls = [];
  const view = mountDeleteWorkspaceModal({
    workspaceName: () => "Example Workspace",
    onLoadTickets: async () => [
      { title: "Active work", status: "in_progress" },
      { title: "Finished work", status: "done" },
    ],
    onArchiveTickets: async () => {
      calls.push("archive");
      if (archiveFailures-- > 0) throw new Error("archive unavailable");
    },
    onDeleteWorkspace: async () => {
      calls.push("delete");
      if (deleteFailures-- > 0) throw new Error("delete unavailable");
    },
    onDeleted: () => calls.push("deleted"),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    const trigger = view.host.querySelector("button");
    assert.equal(trigger.textContent.trim(), "Delete workspace…");
    trigger.click();
    await flush();
    let dialog = view.host.querySelector("dialog");
    assert.equal(dialog.open, true);
    assert.match(dialog.textContent, /Active work[\s\S]*in_progress/);
    assert.match(dialog.textContent, /Finished work[\s\S]*done/);
    assert.match(dialog.textContent, /Done tickets will remain unchanged/);
    assert.match(dialog.textContent, /No ticket files will be deleted/);
    const firstConfirm = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Archive tickets"),
    );
    firstConfirm.click();
    await flush();
    assert.equal(
      dialog.open,
      true,
      "archive failure leaves the warning recoverable",
    );
    assert.match(dialog.textContent, /Could not archive the tickets/);
    assert.equal(
      dialog.querySelector('[aria-current="step"]').textContent,
      "1Archive tickets",
    );
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Archive tickets"))
      .click();
    await flush();
    assert.equal(
      dialog.querySelector('[aria-current="step"]').textContent,
      "2Delete",
    );
    const deleteButton = [...dialog.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Delete workspace"),
    );
    assert.ok(deleteButton.className.includes("danger"));
    assert.ok(deleteButton.querySelector('svg[aria-hidden="true"]'));
    assert.match(
      dialog.textContent,
      /Delete Example Workspace\? Linked repository, ticket files, and OpenCode conversations will not be removed\./,
    );
    deleteButton.click();
    await flush();
    assert.equal(
      dialog.open,
      true,
      "delete failure leaves confirmation recoverable",
    );
    assert.match(dialog.textContent, /Could not delete the Workspace/);
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Delete workspace"))
      .click();
    await flush();
    assert.equal(dialog.open, false);
    assert.deepEqual(calls, [
      "archive",
      "archive",
      "delete",
      "delete",
      "deleted",
    ]);
  } finally {
    view.dispose();
  }
});

test("workspace deletion with no active tickets skips archiving and opens delete confirmation", async () => {
  const calls = [];
  const view = mountDeleteWorkspaceModal({
    onLoadTickets: async () => [],
    onArchiveTickets: async () => calls.push("archive"),
    onDeleteWorkspace: async () => calls.push("delete"),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    view.host.querySelector("button").click();
    await flush();
    const dialog = view.host.querySelector("dialog");
    assert.doesNotMatch(dialog.textContent, /No active tickets to archive/);
    assert.equal(
      dialog.querySelector('[aria-current="step"]').textContent,
      "2Delete",
    );
    assert.equal(
      dialog.querySelector('[aria-disabled="true"]').textContent,
      "1Archive tickets",
    );
    assert.deepEqual(calls, []);
    assert.ok(
      [...dialog.querySelectorAll("button")].some((button) =>
        button.textContent.includes("Delete workspace"),
      ),
    );
    assert.match(
      dialog.textContent,
      /Delete this Workspace\? Linked repository, ticket files, and OpenCode conversations will not be removed\./,
    );
  } finally {
    view.dispose();
  }
});

test("ticket creation investigation checkbox is opt-in and resets for each new ticket", async () => {
  const creations = [];
  const view = mountIdeaModal({
    onPropose: async () => ({ title: "Ticket", body: "Ticket body" }),
    onCreate: async (...args) => creations.push(args),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    view.host.querySelector("button").click();
    const idea = view.host.querySelector("#ticket-idea");
    idea.value = "Investigate this";
    idea.dispatchEvent(new Event("input", { bubbles: true }));
    view.host.querySelector('button[type="submit"]').click();
    await flush();
    const option = [
      ...view.host.querySelectorAll('input[type="checkbox"]'),
    ].find((input) =>
      input.closest("label")?.textContent.includes("Start ticket"),
    );
    assert.ok(option);
    assert.equal(option.checked, false);
    const optionLabel = option.closest("label");
    assert.equal(
      optionLabel.parentElement,
      view.host.querySelector("dialog footer > div"),
    );
    assert.doesNotMatch(
      optionLabel.textContent,
      /clear, low-effort, and one obvious path/,
    );
    const footerItems = [...optionLabel.parentElement.children];
    const createButton = footerItems.find((item) =>
      item.textContent.includes("Create ticket"),
    );
    assert.ok(
      footerItems.indexOf(optionLabel) < footerItems.indexOf(createButton),
    );
    option.checked = true;
    option.dispatchEvent(new Event("change", { bubbles: true }));
    view.host.querySelector("dialog footer button:last-child").click();
    await flush();
    assert.deepEqual(creations, [["Ticket", "Ticket body", true]]);

    view.host.querySelector("button").click();
    const reopenedIdea = view.host.querySelector("#ticket-idea");
    reopenedIdea.value = "Another idea";
    reopenedIdea.dispatchEvent(new Event("input", { bubbles: true }));
    view.host.querySelector('button[type="submit"]').click();
    await flush();
    const reopenedOption = [
      ...view.host.querySelectorAll('input[type="checkbox"]'),
    ].find((input) =>
      input.closest("label")?.textContent.includes("Start ticket"),
    );
    assert.equal(reopenedOption.checked, false);
  } finally {
    view.dispose();
  }
});

test("ticket browser keeps selection separate from Work, renders the complete safe Markdown reader, and formats frontmatter after it", () => {
  const [selected, setSelected] = createSignal(null);
  const calls = [];
  const view = mount({
    workspaceName: () => "Example Workspace",
    tickets: () => tickets,
    selectedFilename: selected,
    loading: () => false,
    error: () => "",
    selectedModel: () => JSON.stringify({ providerId: "fixture", id: "model" }),
    modelBusy: () => false,
    modelOptions: () => [
      {
        value: JSON.stringify({ providerId: "fixture", id: "model" }),
        label: "Fixture model",
      },
    ],
    onSelect: (filename) => {
      calls.push(["select", filename]);
      setSelected(filename);
    },
    onArchiveChange: (archived) => calls.push(["archive", archived]),
    onProposeTicket: () => calls.push(["propose"]),
    onCreateTicket: () => calls.push(["create"]),
    onRefresh: () => calls.push(["refresh"]),
    onWork: (filename) => calls.push(["work", filename]),
  });
  try {
    assert.deepEqual(
      [...view.host.querySelector("#workspace-ticket-title").children].map(
        (part) => part.textContent,
      ),
      ["Workspace", "/", "Example Workspace", "/", "Tickets"],
    );
    const first = view.host.querySelector("ul li");
    assert.match(first.textContent, /Blocked/);
    assert.equal(
      view.host.querySelector("ul li button").children[1].textContent,
      "Second",
    );
    const waitingIcon = first.querySelector(
      '[aria-label="OpenCode is waiting for your input"]',
    );
    assert.ok(
      waitingIcon,
      "the ticket reader shows waiting input independently of workflow status",
    );
    assert.equal(waitingIcon.parentElement.firstElementChild, waitingIcon);
    assert.equal(first.querySelector("p"), null, "rows have no body preview");
    first.querySelector('button[aria-label="Work ticket: Second"]').click();
    assert.deepEqual(calls, [
      ["select", "two.md"],
      ["work", "two.md"],
    ]);
    const noSessionAction = first.querySelector(
      'button[aria-label="Work ticket: Second"]',
    );
    assert.equal(noSessionAction.textContent.trim(), "Work");
    assert.equal(
      noSessionAction.querySelector("svg"),
      null,
      "Work has no session icon",
    );
    first.querySelector("button[aria-pressed]").click();
    assert.deepEqual(calls, [
      ["select", "two.md"],
      ["work", "two.md"],
      ["select", "two.md"],
    ]);
    // Set the selected row to the long Markdown ticket.
    const selectFirst = [
      ...view.host.querySelectorAll("button[aria-pressed]"),
    ].find((button) => button.textContent.includes("First"));
    selectFirst.click();
    assert.deepEqual(calls.at(-1), ["select", "one.md"]);
    const detail = view.host.querySelector("article");
    assert.equal(detail.getAttribute("aria-label"), "Selected ticket: First");
    const titleHeading = detail.querySelector(":scope > header > h2");
    assert.equal(titleHeading.querySelector("strong")?.textContent, "First");
    assert.equal(
      titleHeading.querySelector('[aria-label="Status: Draft"]')?.textContent,
      "Draft",
    );
    assert.match(
      titleHeading.textContent,
      /Draft\s+Example Project\s+-\s+First/,
    );
    assert.equal(titleHeading.querySelectorAll("h1").length, 0);
    const markdown = detail.children[1];
    assert.equal(
      markdown.querySelector("h1"),
      null,
      "a body H1 matching the title is suppressed",
    );
    assert.equal(
      markdown.textContent.includes("First"),
      false,
      "the duplicate title is not rendered in the body",
    );
    assert.equal(markdown.textContent.includes(longContent), true);
    assert.equal(detail.querySelector("script"), null);
    assert.equal(
      detail.querySelector('[aria-label="Ticket metadata"] dt').textContent,
      "title",
    );
    assert.equal(
      detail.querySelector('[aria-label="Ticket metadata"] dd').textContent,
      "First",
    );
    assert.equal(
      detail.querySelector('[aria-label="OpenCode session is paused"]'),
      null,
    );
    assert.equal(
      markdown.compareDocumentPosition(
        detail.querySelector('[aria-label="Ticket metadata"]'),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    assert.equal(selectFirst.getAttribute("aria-pressed"), "true");
    const idleRow = [
      ...view.host.querySelectorAll("button[aria-pressed]"),
    ].find((button) => button.textContent.includes("Third"));
    idleRow.click();
    assert.equal(
      view.host.querySelectorAll('[aria-label="OpenCode session is paused"]')
        .length,
      2,
    );
    const idleIcon = idleRow.querySelector(
      '[aria-label="OpenCode session is paused"]',
    );
    assert.equal(
      idleIcon.parentElement.firstElementChild,
      idleIcon,
      "the icon precedes the ticket title",
    );
    assert.match(
      idleIcon.querySelector("svg path").getAttribute("d"),
      /a6\.5 6\.5.*v5m4-5v5$/,
      "idle status uses a circled pause icon",
    );
    assert.match(
      idleRow.textContent,
      /Third/,
      "the idle icon supplements rather than replaces the title",
    );
    assert.equal(
      view.host.querySelector('[aria-label="Ticket metadata"] dt')?.textContent,
      "title",
    );
    assert.equal(
      [...view.host.querySelectorAll('[aria-label="Ticket metadata"] dt')].some(
        (item) => item.textContent === "opencode-status",
      ),
      false,
    );
    const missingSessionRow = [
      ...view.host.querySelectorAll("button[aria-pressed]"),
    ].find((button) => button.textContent.includes("Fifth"));
    assert.equal(
      missingSessionRow
        .querySelector('[aria-label="Ticket has no work session"] svg path')
        .getAttribute("fill"),
      "var(--ui-caution-fill)",
    );
    const sessionDraftRow = [
      ...view.host.querySelectorAll("button[aria-pressed]"),
    ].find((button) => button.textContent.includes("Draft with session"));
    assert.equal(
      sessionDraftRow.querySelector('[aria-label="Ticket has saved session"]'),
      null,
    );
    assert.equal(
      sessionDraftRow
        .querySelector('[aria-label="OpenCode session is paused"] svg path')
        .getAttribute("d"),
      idleIcon.querySelector("svg path").getAttribute("d"),
      "ready-for-review sessions use the paused icon too",
    );
    const errorRow = [
      ...view.host.querySelectorAll("button[aria-pressed]"),
    ].find((button) => button.textContent.includes("Fourth"));
    assert.ok(
      errorRow.querySelector(
        '[aria-label="OpenCode session needs attention: unknown"]',
      ),
    );
    assert.ok(
      !errorRow.querySelector('[aria-label="OpenCode session is paused"]'),
    );
    const resumeAction = sessionDraftRow.parentElement.querySelector(
      'button[aria-label="Resume ticket: Draft with session"]',
    );
    assert.equal(resumeAction.textContent.trim(), "Resume");
    assert.equal(
      resumeAction.firstChild.nodeType,
      Node.TEXT_NODE,
      "the action label precedes its icon",
    );
    assert.equal(
      resumeAction.querySelectorAll("svg").length,
      1,
      "Resume shows the session icon",
    );
    assert.match(resumeAction.lastElementChild.className, /muted/);
    resumeAction.click();
    assert.deepEqual(calls.slice(-2), [
      ["select", "one-session.md"],
      ["work", "one-session.md"],
    ]);
    const sort = view.host.querySelector('summary[aria-label="Sort: Status"]');
    sort.click();
    [...view.host.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Recently modified"))
      .click();
    assert.equal(
      view.host.querySelector("ul li button").children[1].textContent,
      "Second",
    );
    view.host
      .querySelector('summary[aria-label="Sort: Recently modified"]')
      .click();
    [...view.host.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Title")
      .click();
    assert.equal(
      view.host.querySelector("ul li button").children[1].textContent,
      "Draft with session",
    );
  } finally {
    view.dispose();
  }
});

test("ticket heading keeps its prefix together while allowing a long title to wrap", () => {
  assert.match(
    ticketHeadingStyles,
    /\.ticketHeading\s*\{[^}]*overflow-wrap:\s*anywhere/s,
  );
  assert.doesNotMatch(
    ticketHeadingStyles,
    /\.ticketProjectLabel\s*\{[^}]*white-space:\s*nowrap/s,
  );
  assert.match(statusBadgeStyles, /\.badge\s*\{[^}]*white-space:\s*nowrap/s);
});

test("archive toggle reports state and clears selection; create opens the first modal step", () => {
  const calls = [];
  const view = mount({
    workspaceName: () => "Example Workspace",
    tickets: () => tickets,
    selectedFilename: () => "two.md",
    loading: () => false,
    error: () => "",
    onSelect: (filename) => calls.push(["select", filename]),
    onArchiveChange: (archived) => calls.push(["archive", archived]),
    selectedModel: () => "fixture:model",
    modelBusy: () => false,
    onModelChange: () => {},
    onProposeTicket: () => calls.push(["propose"]),
    onCreateTicket: () => calls.push(["create"]),
    onRefresh: () => calls.push(["refresh"]),
  });
  try {
    [...view.host.querySelectorAll("button")]
      .find((button) => button.textContent === "Create ticket…")
      .click();
    assert.equal(
      view.host.querySelector(
        '[aria-label="Ticket creation steps"] [aria-current="step"]',
      )?.firstElementChild.textContent,
      "1",
    );
    assert.match(view.host.querySelector("dialog").textContent, /Description/);
    view.host.querySelector('button[aria-label="Refresh tickets"]').click();
    const archiveSwitch = view.host.querySelector('input[role="switch"]');
    assert.equal(
      archiveSwitch.closest("label").textContent.trim(),
      "Show archived",
    );
    archiveSwitch.checked = true;
    archiveSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    assert.equal(
      view.host.querySelector("ul").getAttribute("aria-label"),
      "Archived tickets",
    );
    assert.deepEqual(calls, [["refresh"], ["archive", true], ["select", null]]);
    archiveSwitch.checked = false;
    archiveSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(calls.slice(-2), [
      ["archive", false],
      ["select", null],
    ]);
    assert.equal(
      view.host.querySelector("ul").getAttribute("aria-label"),
      "Tickets",
    );
  } finally {
    view.dispose();
  }
});

test("active and archived ticket sorts are independent and archived rows show archive time", async () => {
  const archivedTickets = [
    {
      filename: "later.md",
      title: "Later",
      status: "done",
      modifiedAt: 100,
      archivedAt: "2025-01-01T12:00:00.000Z",
      content: "---\ntitle: Later\nstatus: done\n---\n",
    },
    {
      filename: "earlier.md",
      title: "Earlier",
      status: "cancelled",
      modifiedAt: 900,
      archivedAt: "2024-01-01T12:00:00.000Z",
      content: "---\ntitle: Earlier\nstatus: cancelled\n---\n",
    },
  ];
  const view = mount({
    workspaceName: () => "Example Workspace",
    tickets: () => archivedTickets,
    selectedFilename: () => null,
    loading: () => false,
    error: () => "",
    onSelect: () => {},
    onArchiveChange: () => {},
  });
  const chooseSort = (current, next) => {
    view.host.querySelector(`summary[aria-label="Sort: ${current}"]`).click();
    [...view.host.querySelectorAll("[role=group] button")]
      .find((button) => button.textContent.trim() === next)
      .click();
  };
  const firstTitle = () =>
    view.host.querySelector("ul li button").children[1].textContent;
  try {
    assert.equal(
      view.host.querySelector('summary[aria-label="Sort: Status"]') !== null,
      true,
    );
    chooseSort("Status", "Recently modified");
    assert.equal(
      firstTitle(),
      "Earlier",
      "active recently-modified sort remains unchanged",
    );

    const archiveSwitch = view.host.querySelector('input[role="switch"]');
    archiveSwitch.checked = true;
    archiveSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    assert.ok(
      view.host.querySelector('summary[aria-label="Sort: Archive time"]'),
      "archived view defaults to archive time",
    );
    assert.equal(
      firstTitle(),
      "Later",
      "archive order uses archivedAt rather than modifiedAt",
    );
    assert.equal(
      view.host.querySelector("ul li time").getAttribute("datetime"),
      "2025-01-01T12:00:00.000Z",
    );
    assert.equal(
      view.host.querySelector("ul li time").textContent,
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date("2025-01-01T12:00:00.000Z"),
      ),
      "archived date display omits the time",
    );
    const date = view.host.querySelector("ul li time");
    assert.equal(
      date.getAttribute("aria-label"),
      `Archived ${date.textContent}`,
    );
    date.dispatchEvent(new Event("mouseenter"));
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(
      document.querySelector('[role="tooltip"]')?.textContent,
      "2025-01-01T12:00:00.000Z",
    );
    date.dispatchEvent(new Event("mouseleave"));
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(document.querySelector('[role="tooltip"]'), null);

    chooseSort("Archive time", "Title");
    assert.equal(firstTitle(), "Earlier");
    archiveSwitch.checked = false;
    archiveSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    assert.ok(
      view.host.querySelector('summary[aria-label="Sort: Recently modified"]'),
      "archived sort change does not affect active sort",
    );
    archiveSwitch.checked = true;
    archiveSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    assert.ok(
      view.host.querySelector('summary[aria-label="Sort: Title"]'),
      "archived sort selection is retained independently",
    );
  } finally {
    view.dispose();
  }
});
