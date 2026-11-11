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
const temp = await mkdtemp("/tmp/opencode/workbench-ui-");
const entry = join(temp, "entry.js");
await writeFile(
  entry,
  `
export { render } from ${JSON.stringify(resolve(root, "node_modules/solid-js/web/dist/web.js"))};
export { createComponent, createSignal } from ${JSON.stringify(resolve(root, "node_modules/solid-js/dist/solid.js"))};
export { SessionTabList } from ${JSON.stringify(resolve(root, "src/views/workspace/sessions/SessionTabList.jsx"))};
export { WorkspaceShell } from ${JSON.stringify(resolve(root, "src/views/workspace/WorkspaceShell.jsx"))};
export { TabList } from "@ui-lib";
export { RepositoryToolsMenu } from ${JSON.stringify(resolve(root, "src/views/workspace/repository-tools/RepositoryToolsMenu.jsx"))};
export { WorkspaceOwnerPanel } from ${JSON.stringify(resolve(root, "src/views/workspace/sessions/WorkspaceOwnerPanel.jsx"))};
export { NewWorkModal } from ${JSON.stringify(resolve(root, "src/features/new-work/modal/NewWorkModal.jsx"))};
export { createQuickRequestCreationController } from ${JSON.stringify(resolve(root, "src/features/new-work/modal/quickRequestCreationController.js"))};
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
  "Event",
  "MouseEvent",
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
  SessionTabList,
  WorkspaceShell,
  TabList,
  RepositoryToolsMenu,
  WorkspaceOwnerPanel,
  NewWorkModal,
  createQuickRequestCreationController,
} = await import(pathToFileURL(join(temp, "out/test.js")));
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

test("Quick Request confirmation disables repeat clicks and allows retry after creation fails", async () => {
  const [disabled, setDisabled] = createSignal(false);
  const [error, setError] = createSignal("");
  const [review, setReview] = createSignal(true);
  const proposal = {
    workType: "quick_request",
    title: "Confirm",
    createLabel: "Start Quick Request",
    originalPrompt: "Keep this prompt",
  };
  let rejectCreation;
  let attempts = 0;
  let pending;
  const noop = () => {};
  const controller = createQuickRequestCreationController({
    getProposal: () => proposal,
    modelsReady: () => true,
    quickRequestDirectoryReady: () => true,
    getOriginalPrompt: () => proposal.originalPrompt,
    getSelectedModel: () => '{"providerId":"p","id":"m"}',
    getRepositoryId: () => null,
    getDirectory: () => "/work",
    proposalSessionId: () => null,
    submitResolvedQuickRequestFlow: () => {
      attempts++;
      if (attempts === 1)
        return new Promise((_, reject) => {
          rejectCreation = reject;
        });
      return Promise.resolve();
    },
    setCreateDisabled: setDisabled,
    setOwnerSetupBusy: noop,
    setProposalError: setError,
    clearOwnerSetupNotice: noop,
    setProgressProposalSession: noop,
    setNewWorkView: () => setReview(false),
    clearProposal: noop,
    closeModal: noop,
    syncPendingPrompt: noop,
    formatWorkspaceError: (label, failure) => `${label}: ${failure.message}`,
  });
  const empty = () => "",
    no = () => false,
    noopSetter = () => {};
  const view = mount(NewWorkModal, {
    setModal: noop,
    setPromptElement: noop,
    reviewVisible: review,
    captureVisible: no,
    workType: () => "quick_request",
    proposal: () => proposal,
    proposalError: error,
    proposalCreateDisabled: disabled,
    onConfirm: () => {
      pending = controller.createQuickRequest();
    },
    workspaceName: empty,
    startingPrompt: empty,
    directoryPath: () => "/work",
    proposalModelDisabled: no,
    proposalSelectedModel: () => '{"providerId":"p","id":"m"}',
    proposalModels: () => [
      { value: '{"providerId":"p","id":"m"}', label: "Model" },
    ],
    progressVisible: no,
    progressRows: () => [],
    prompt: empty,
    setPrompt: noopSetter,
    setWorkspaceName: noopSetter,
    setStartingPrompt: noopSetter,
  });
  try {
    const button = view.host.querySelector("#proposal-create");
    button.click();
    assert.equal(button.disabled, true);
    button.click();
    assert.equal(attempts, 1);
    rejectCreation(new Error("Cannot create request"));
    await pending;
    assert.match(
      view.host.querySelector("#proposal-error").textContent,
      /Cannot create request/,
    );
    assert.equal(
      view.host.querySelector("#quick-request-original").textContent,
      "Keep this prompt",
    );
    assert.equal(button.disabled, false);
    button.click();
    await pending;
    assert.equal(attempts, 2);
    assert.equal(view.host.querySelector("#proposal-error"), null);
    assert.equal(review(), false);
  } finally {
    view.dispose();
  }
});

test("session tabs retain terminal associations and action callbacks", () => {
  const calls = [];
  const view = mount(TabList, {
    label: "Sessions",
    value: "s1",
    get children() {
      return createComponent(SessionTabList, {
        tabs: () => [
          {
            sessionId: "s1",
            ownerKey: "w1",
            label: "Session",
            visible: true,
            selected: true,
            restartable: true,
            closeable: true,
            onSelect: () => calls.push("select"),
            onRestart: () => calls.push("restart"),
            onClose: () => calls.push("close"),
          },
        ],
      });
    },
  });
  const tab = view.host.querySelector("[role=tab]");
  assert.equal(tab.getAttribute("aria-controls"), "terminal-s1");
  assert.equal(tab.dataset.ownerKey, "w1");
  assert.equal(tab.getAttribute("aria-selected"), "true");
  assert.equal(tab.tabIndex, 0);
  tab.click();
  view.host.querySelector("[data-restart-session]").click();
  view.host.querySelector('[aria-label="Close Session"]').click();
  assert.deepEqual(calls, ["select", "restart", "close"]);
  view.dispose();
});

test("workspace views share one tablist and switching views never closes a session", () => {
  const [docsSelected, setDocsSelected] = createSignal(false);
  const [reviewSelected, setReviewSelected] = createSignal(false);
  const [docsDisabled, setDocsDisabled] = createSignal(false);
  const [reviewAvailable, setReviewAvailable] = createSignal(true);
  const [reviewDisabled, setReviewDisabled] = createSignal(false);
  const [newSessionDisabled, setNewSessionDisabled] = createSignal(false);
  let selects = 0,
    closes = 0,
    docsOpens = 0,
    reviewOpens = 0,
    newSessionStarts = 0;
  const tabs = () =>
    createComponent(SessionTabList, {
      tabs: () => [
        {
          sessionId: "code",
          ownerKey: "w1",
          label: "OpenCode",
          visible: true,
          selected: true,
          closeable: true,
          onSelect: () => {
            selects++;
            setDocsSelected(false);
            setReviewSelected(false);
          },
          onClose: () => closes++,
        },
        { sessionId: "other", visible: false, label: "Other owner" },
      ],
    });
  const view = mount(WorkspaceShell, {
    visible: () => true,
    sessionTabs: tabs,
    newSessionDisabled,
    onNewSession: () => newSessionStarts++,
    selectedSessionId: () => "code",
    docsButtonSelected: docsSelected,
    docsDisabled,
    changeReviewSelected: reviewSelected,
    changeReviewAvailable: reviewAvailable,
    changeReviewDisabled: reviewDisabled,
    onOpenDocs: () => {
      docsOpens++;
      setDocsSelected(true);
      setReviewSelected(false);
    },
    onOpenChangeReview: () => {
      reviewOpens++;
      setReviewSelected(true);
      setDocsSelected(false);
    },
    repositoryTools: () => document.createElement("details"),
  });
  const code = view.host.querySelector('[data-session-id="code"]');
  const docs = view.host.querySelector("#show-docs");
  const review = view.host.querySelector("#show-change-review");
  const newSession = view.host.querySelector("#new-ticket-session");
  assert.ok(newSession);
  assert.equal(newSession.getAttribute("aria-label"), "New session");
  assert.equal(
    newSession.querySelector("svg path").getAttribute("d"),
    "M8 3v10M3 8h10",
  );
  assert.equal(Boolean(newSession.compareDocumentPosition(review) & 4), true);
  newSession.click();
  assert.equal(newSessionStarts, 1);
  setNewSessionDisabled(true);
  assert.equal(newSession.disabled, true);
  assert.equal(view.host.querySelectorAll('[role="tablist"]').length, 1);
  assert.equal(docs.getAttribute("role"), "tab");
  assert.equal(review.getAttribute("role"), "tab");
  assert.equal(docs.getAttribute("aria-controls"), "docs-page");
  assert.equal(review.getAttribute("aria-controls"), "change-review-page");
  docs.click();
  assert.equal(docs.getAttribute("aria-selected"), "true");
  assert.equal(code.getAttribute("aria-selected"), "false");
  assert.equal(code.tabIndex, -1);
  setDocsDisabled(true);
  assert.equal(
    docs.disabled,
    false,
    "Loading must not remove focus from the active view tab",
  );
  assert.equal(docs.tabIndex, 0);
  docs.click();
  assert.equal(
    docsOpens,
    1,
    "Loading blocks duplicate document opens without disabling the active tab",
  );
  docs.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
  );
  assert.equal(selects, 1);
  assert.equal(document.activeElement, code);
  assert.equal(view.host.querySelector('[data-session-id="code"]'), code);
  assert.equal(closes, 0, "Switching views never closes a terminal");
  setDocsDisabled(true);
  assert.equal(docs.disabled, true);
  review.click();
  setReviewDisabled(true);
  assert.equal(review.disabled, false);
  review.click();
  assert.equal(
    reviewOpens,
    1,
    "Loading blocks duplicate review opens without disabling the active tab",
  );
  setReviewAvailable(false);
  assert.equal(review.closest("[hidden]") !== null, true);
  assert.equal(
    view.host.querySelector('[role="tablist"] details'),
    null,
    "Tools stays outside tab navigation",
  );
  view.dispose();
});

test("ticket Workbench heading keeps workspace, Tickets, and shortened ticket context", () => {
  const title = "A rather long ticket title that needs shortening in the breadcrumb";
  let returnedToTickets = false;
  const view = mount(WorkspaceShell, {
    visible: () => true,
    workspaceName: () => "Project Workspace",
    ticketTitle: () => title,
    onWorkspaceClick: () => { returnedToTickets = true; },
    sessionTabs: () => [],
    selectedSessionId: () => "",
    docsButtonSelected: () => false,
    docsDisabled: () => true,
    changeReviewSelected: () => false,
    changeReviewAvailable: () => false,
    changeReviewDisabled: () => true,
    repositoryTools: () => null,
  });
  try {
    const heading = view.host.querySelector("#workspace-title");
    const segments = heading.textContent.split("/").map((segment) => segment.trim());
    assert.equal(segments[0], "Workspace");
    assert.equal(segments[1], "Project Workspace");
    assert.equal(segments[2], "Tickets");
    assert.equal(segments[3].startsWith("A rather long ticket title"), true);
    assert.equal(segments[3].endsWith("…"), true);
    const shortened = [...heading.querySelectorAll("span")].find((span) => span.title === title);
    assert.ok(shortened);
    assert.equal(shortened.textContent.endsWith("…"), true);
    const backButton = heading.querySelector('button[aria-label="Back to tickets for Project Workspace"]');
    assert.ok(backButton);
    assert.equal(backButton.textContent, "Project Workspace");
    backButton.click();
    assert.equal(returnedToTickets, true);
  } finally {
    view.dispose();
  }
});

test("repository menu remains controlled and forwards selected tool", () => {
  const [open, setOpen] = createSignal(false);
  const calls = [];
  const view = mount(RepositoryToolsMenu, {
    open,
    available: () => true,
    disabled: () => false,
    error: () => "",
    groups: () => [{ name: "Repo", packageScripts: ["test"], makeTargets: [] }],
    onToggle: () => setOpen(!open()),
    onRun: (...args) => calls.push(args),
    onHandoff: () => {},
  });
  const toggle = view.host.querySelector("#show-repo-tools");
  const menu = view.host.querySelector("#repo-tools-menu");
  const disclosure = toggle.closest("details");
  assert.equal(disclosure.open, false);
  toggle.click();
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(disclosure.open, true);
  [...menu.querySelectorAll("button")]
    .find((button) => button.textContent === "test")
    .click();
  assert.equal(calls[0][1], "npm_script");
  assert.equal(calls[0][2], "test");
  view.dispose();
});

test("repository menu omits the repository section when empty", () => {
  const [groups, setGroups] = createSignal([]);
  const view = mount(RepositoryToolsMenu, {
    open: () => true,
    available: () => true,
    disabled: () => false,
    error: () => "Load failed",
    groups,
    onToggle: () => {},
    onHandoff: () => {},
    onRun: () => {},
  });
  const menu = view.host.querySelector("#repo-tools-menu");
  assert.match(menu.textContent, /Open terminal/);
  assert.match(menu.textContent, /Load failed/);
  assert.doesNotMatch(menu.textContent, /No associated repositories/);
  assert.equal(menu.querySelector("hr"), null);
  setGroups([{ name: "Repo", packageScripts: ["test"], makeTargets: [] }]);
  assert.match(menu.textContent, /Repo/);
  assert.ok(menu.querySelector("hr"));
  setGroups([]);
  assert.equal(menu.querySelector("hr"), null);
  view.dispose();
});

test("owner visibility preserves the terminal while removed workspace controls stay absent", () => {
  const [visible, setVisible] = createSignal(true);
  const [quickRequest, setQuickRequest] = createSignal(false);
  let quickSubmissions = 0,
    keydowns = 0;
  const falseValue = () => false,
    empty = () => "",
    list = () => [];
  const props = {
    visible,
    proposalMode: falseValue,
    title: empty,
    description: empty,
    status: empty,
    pendingPromptVisible: falseValue,
    pendingPromptText: empty,
    pendingPromptDisabled: falseValue,
    pendingPromptLabel: empty,
    sessionStatus: empty,
    quickRequestTerminalActions: falseValue,
    selectedAttachRepository: empty,
    attachRepositoryOptions: list,
    quickRequest,
    attachRepositoryDisabled: falseValue,
    completeWorkspaceDisabled: falseValue,
    reactivateWorkspaceDisabled: falseValue,
    repositories: list,
    workspacePrompt: empty,
    workspaceSessionSubmitDisabled: falseValue,
    terminalRuntimeStartupFailed: falseValue,
    quickRequestBusy: falseValue,
    quickPrompt: empty,
    modelBusy: falseValue,
    modelDisabled: falseValue,
    selectedModel: empty,
    modelOptions: list,
    modelError: empty,
    quickRequestError: empty,
    onWorkspacePromptInput: (value) => {
      prompt = value;
    },
    onWorkspaceSessionSubmit: (event) => {
      event.preventDefault();
      workspaceSubmissions++;
    },
    onQuickRequestSubmit: (event) => {
      event.preventDefault();
      quickSubmissions++;
    },
    onEnterToSubmit: () => {
      keydowns++;
    },
  };
  const view = mount(WorkspaceOwnerPanel, props);
  const terminal = view.host.querySelector("#terminal-views");
  const quickForm = view.host.querySelector("#quick-request-form");
  assert.equal(view.host.querySelector("#workspace-session-form"), null);
  assert.equal(view.host.querySelector("#workspace-prompt"), null);
  assert.equal(quickForm.hidden, true);
  assert.equal(view.host.querySelector("#quick-prompt").required, true);
  assert.equal(view.host.querySelector("#quick-model-value").required, true);
  assert.equal(view.host.querySelector("#quick-submit").type, "submit");
  const child = document.createElement("div");
  terminal.append(child);
  quickForm.dispatchEvent(new Event("keydown", { bubbles: true }));
  quickForm.dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  setQuickRequest(true);
  setQuickRequest(false);
  setVisible(false);
  setVisible(true);
  assert.equal(view.host.querySelector("#terminal-views"), terminal);
  assert.equal(terminal.firstChild, child);
  assert.equal(quickSubmissions, 1);
  assert.equal(keydowns, 1);
  view.dispose();
});
