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
  export { WorkspaceTicketViewer } from ${JSON.stringify(resolve(root, "src/views/workspace/tickets/WorkspaceTicketViewer.jsx"))};
  export { CreateTicketIdeaModal } from ${JSON.stringify(resolve(root, "src/views/workspace/tickets/CreateTicketIdeaModal.jsx"))};
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
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "Event"])
  globalThis[key] = key === "window" ? window : key === "document" ? window.document : window[key];
const { render, createComponent, createSignal, WorkspaceTicketViewer, CreateTicketIdeaModal } =
  await import(pathToFileURL(join(temp, "out/test.js")));

function mount(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => createComponent(WorkspaceTicketViewer, props), host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}

function mountIdeaModal(props) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => createComponent(CreateTicketIdeaModal, props), host);
  return { host, dispose: () => { dispose(); host.remove(); } };
}

const longContent = "x".repeat(1300);
const tickets = [
  { filename: "one.md", title: "First", status: "draft", modifiedAt: 100, content: `---\ntitle: First\nstatus: draft\nowner: Alice\n---\n# First body\n\n${longContent}` },
  { filename: "one-session.md", title: "Draft with session", status: "draft", hasWorkSession: true, modifiedAt: 90, content: "---\ntitle: Draft with session\nstatus: draft\nwork_session_id: ses-draft\n---\nDraft body" },
  { filename: "two.md", title: "Second", status: "blocked", hasWorkSession: false, opencodeStatus: "idle", modifiedAt: 200, content: "---\ntitle: Second\nstatus: blocked\nopencode-status: idle\n---\nSecond body" },
  { filename: "three.md", title: "Third", status: "in_progress", hasWorkSession: true, opencodeStatus: "idle", modifiedAt: 50, content: "---\ntitle: Third\nstatus: in_progress\nwork_session_id: ses-three\nopencode-status: idle\n---\nThird body" },
  { filename: "four.md", title: "Fourth", status: "in_progress", hasWorkSession: true, opencodeStatus: "busy", modifiedAt: 60, content: "---\ntitle: Fourth\nstatus: in_progress\nwork_session_id: ses-four\nopencode-status: busy\n---\nFourth body" },
  { filename: "five.md", title: "Fifth", status: "in_progress", hasWorkSession: false, modifiedAt: 40, content: "---\ntitle: Fifth\nstatus: in_progress\n---\nFifth body" },
];

test.after(async () => {
  await window.happyDOM.abort();
  await rm(temp, { recursive: true, force: true });
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
      { value: JSON.stringify({ providerId: "fixture", id: "other" }), label: "Other model" },
    ],
    onModelChange: (value) => calls.push(value),
  });
  try {
    const trigger = view.host.querySelector('summary[aria-label="Fixture model"]');
    assert.ok(trigger);
    assert.match(view.host.textContent, /Default Model/);
    trigger.click();
    assert.ok(view.host.querySelector('[role="group"] button[aria-pressed="true"] svg[aria-hidden="true"]'));
    view.host.querySelector('[role="group"] button[aria-pressed="false"]').click();
    assert.deepEqual(calls, [JSON.stringify({ providerId: "fixture", id: "other" })]);
  } finally { view.dispose(); }
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
    assert.ok([...view.host.querySelectorAll("button")].some((button) => button.textContent === "Tools"));
  } finally { view.dispose(); }
});

test("ticket idea modal marks both current steps, keeps failed edits open, and closes after success", async () => {
  let failures = 1;
  const proposals = [];
  const creations = [];
  const view = mountIdeaModal({
    onPropose: async (idea) => {
      proposals.push(idea);
      return { title: "Proposed title", body: "# Proposed title\n\nOriginal body" };
    },
    onCreate: async (title, body) => {
      creations.push([title, body]);
      if (failures-- > 0) throw new Error("disk unavailable");
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    view.host.querySelector("button").click();
    assert.equal(view.host.querySelectorAll('[aria-label="Ticket creation steps"] li').length, 2);
    assert.equal(view.host.querySelector('[aria-current="step"]').firstElementChild.textContent, "1");
    assert.deepEqual(
      [...view.host.querySelectorAll('[aria-label="Ticket creation steps"] li')].map((item) => item.lastElementChild.textContent),
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
    assert.equal(view.host.querySelector('[aria-current="step"]').firstElementChild.textContent, "2");
    assert.deepEqual(
      [...view.host.querySelectorAll('[aria-label="Ticket creation steps"] li')].map((item) => item.lastElementChild.textContent),
      ["Description", "Review"],
      "both step labels remain visible on the review step",
    );
    assert.equal(view.host.querySelectorAll('[aria-label="Ticket creation steps"] li').length, 2);
    const title = view.host.querySelector("#ticket-title");
    const body = view.host.querySelector("#ticket-body");
    title.value = "Edited title";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    body.value = "Edited Markdown";
    body.dispatchEvent(new Event("input", { bubbles: true }));
    view.host.querySelector("dialog footer button:last-child").click();
    await flush();
    assert.equal(view.host.querySelector("dialog").open, true);
    assert.equal(view.host.querySelector("#ticket-title").value, "Edited title");
    assert.equal(view.host.querySelector("#ticket-body").value, "Edited Markdown");
    assert.match(view.host.querySelector('[role="alert"]').textContent, /Your edits are still here/);
    view.host.querySelector("dialog footer button:last-child").click();
    await flush();
    assert.equal(view.host.querySelector("dialog").open, false);
    assert.deepEqual(creations, [["Edited title", "Edited Markdown"], ["Edited title", "Edited Markdown"]]);
    view.host.querySelector("button").click();
    view.host.querySelector('button[type="submit"]').closest("dialog").querySelector('button[aria-label="Close dialog"]').click();
    assert.equal(view.host.querySelector("dialog").open, false);
    assert.equal(creations.length, 2, "cancel does not create a ticket");
    assert.equal(proposals.length, 1, "cancel does not start another proposal");
  } finally { view.dispose(); }
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
    modelOptions: () => [{
      value: JSON.stringify({ providerId: "fixture", id: "model" }),
      label: "Fixture model",
    }],
    onSelect: (filename) => { calls.push(["select", filename]); setSelected(filename); },
    onArchiveChange: (archived) => calls.push(["archive", archived]),
    onProposeTicket: () => calls.push(["propose"]),
    onCreateTicket: () => calls.push(["create"]),
    onRefresh: () => calls.push(["refresh"]),
    onWork: (filename) => calls.push(["work", filename]),
  });
  try {
    assert.deepEqual(
      [...view.host.querySelector("#workspace-ticket-title").children].map((part) => part.textContent),
      ["Workspace", "/", "Example Workspace", "/", "Tickets"],
    );
    const first = view.host.querySelector("ul li");
    assert.match(first.textContent, /Blocked/);
    assert.equal(view.host.querySelector("ul li button").children[1].textContent, "Second");
    assert.equal(first.querySelector("p"), null, "rows have no body preview");
    first.querySelector('button[aria-label="Work ticket: Second"]').click();
    assert.deepEqual(calls, [["select", "two.md"], ["work", "two.md"]]);
    const noSessionAction = first.querySelector('button[aria-label="Work ticket: Second"]');
    assert.equal(noSessionAction.textContent.trim(), "Work");
    assert.equal(noSessionAction.querySelector("svg"), null, "Work has no session icon");
    first.querySelector('button[aria-pressed]').click();
    assert.deepEqual(calls, [["select", "two.md"], ["work", "two.md"], ["select", "two.md"]]);
    // Set the selected row to the long Markdown ticket.
    const selectFirst = [...view.host.querySelectorAll('button[aria-pressed]')].find((button) => button.textContent.includes("First"));
    selectFirst.click();
    assert.deepEqual(calls.at(-1), ["select", "one.md"]);
    const detail = view.host.querySelector("article");
    assert.equal(detail.getAttribute("aria-label"), "Selected ticket: First");
    assert.equal(detail.querySelector(".detailHeading"), null);
    assert.equal(detail.querySelector("h3"), null);
    assert.equal(detail.children[0].textContent.includes("First body"), true);
    assert.equal(detail.children[0].textContent.includes(longContent), true);
    assert.equal(detail.querySelector("script"), null);
    assert.equal(detail.querySelector('[aria-label="Ticket metadata"] dt').textContent, "title");
    assert.equal(detail.querySelector('[aria-label="Ticket metadata"] dd').textContent, "First");
    assert.equal(detail.querySelector('[aria-label="OpenCode session is idle"]'), null);
    assert.equal(detail.children[0].compareDocumentPosition(detail.querySelector('[aria-label="Ticket metadata"]')) & Node.DOCUMENT_POSITION_FOLLOWING, Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(selectFirst.getAttribute("aria-pressed"), "true");
    const idleRow = [...view.host.querySelectorAll('button[aria-pressed]')].find((button) => button.textContent.includes("Third"));
    idleRow.click();
    assert.equal(view.host.querySelectorAll('[aria-label="OpenCode session is idle"]').length, 1);
    const idleIcon = idleRow.querySelector('[aria-label="OpenCode session is idle"]');
    assert.equal(idleIcon.parentElement.firstElementChild, idleIcon, "the icon precedes the ticket title");
    assert.match(idleIcon.querySelector("svg path").getAttribute("d"), /a6\.5 6\.5.*v5m4-5v5$/, "idle status uses a circled pause icon");
    assert.match(idleRow.textContent, /Third/, "the idle icon supplements rather than replaces the title");
    assert.equal(view.host.querySelector('[aria-label="Ticket metadata"] dt')?.textContent, "title");
    assert.equal([...view.host.querySelectorAll('[aria-label="Ticket metadata"] dt')].some((item) => item.textContent === "opencode-status"), false);
    const missingSessionRow = [...view.host.querySelectorAll('button[aria-pressed]')].find((button) => button.textContent.includes("Fifth"));
    assert.equal(missingSessionRow.querySelector('[aria-label="Ticket has no work session"] svg path').getAttribute("fill"), "var(--ui-caution-fill)");
    const sessionDraftRow = [...view.host.querySelectorAll('button[aria-pressed]')].find((button) => button.textContent.includes("Draft with session"));
    assert.equal(sessionDraftRow.querySelector('[aria-label="Ticket has saved session"]'), null);
    const resumeAction = sessionDraftRow.parentElement.querySelector('button[aria-label="Resume ticket: Draft with session"]');
    assert.equal(resumeAction.textContent.trim(), "Resume");
    assert.equal(resumeAction.firstChild.nodeType, Node.TEXT_NODE, "the action label precedes its icon");
    assert.equal(resumeAction.querySelectorAll("svg").length, 1, "Resume shows the session icon");
    assert.match(resumeAction.lastElementChild.className, /muted/);
    resumeAction.click();
    assert.deepEqual(calls.slice(-2), [["select", "one-session.md"], ["work", "one-session.md"]]);
    const sort = view.host.querySelector('summary[aria-label="Sort: Status"]');
    sort.click();
    [...view.host.querySelectorAll("button")].find((button) => button.textContent.includes("Recently modified")).click();
    assert.equal(view.host.querySelector("ul li button").children[1].textContent, "Second");
    view.host.querySelector('summary[aria-label="Sort: Recently modified"]').click();
    [...view.host.querySelectorAll("button")].find((button) => button.textContent.trim() === "Title").click();
    assert.equal(view.host.querySelector("ul li button").children[1].textContent, "Draft with session");
  } finally { view.dispose(); }
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
    onProposeTicket: () => calls.push(["propose"]),
    onCreateTicket: () => calls.push(["create"]),
    onRefresh: () => calls.push(["refresh"]),
  });
  try {
    [...view.host.querySelectorAll("button")].find((button) => button.textContent === "Create ticket").click();
    assert.equal(view.host.querySelector('[aria-label="Ticket creation steps"] [aria-current="step"]')?.firstElementChild.textContent, "1");
    assert.match(view.host.querySelector("dialog").textContent, /Description/);
    view.host.querySelector('button[aria-label="Refresh tickets"]').click();
    const archiveSwitch = view.host.querySelector('input[role="switch"]');
    assert.equal(archiveSwitch.closest("label").textContent.trim(), "Show archived");
    archiveSwitch.checked = true;
    archiveSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    assert.equal(view.host.querySelector("ul").getAttribute("aria-label"), "Archived tickets");
    assert.deepEqual(calls, [["refresh"], ["archive", true], ["select", null]]);
    archiveSwitch.checked = false;
    archiveSwitch.dispatchEvent(new Event("change", { bubbles: true }));
    assert.deepEqual(calls.slice(-2), [["archive", false], ["select", null]]);
    assert.equal(view.host.querySelector("ul").getAttribute("aria-label"), "Tickets");
  } finally { view.dispose(); }
});
