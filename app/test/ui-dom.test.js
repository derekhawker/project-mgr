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
const temp = await mkdtemp(join(tmpdir(), "project-mgr-ui-dom-"));
const entry = join(temp, "entry.js");
const output = join(temp, "bundle");
await writeFile(
  entry,
  `
  export { render } from ${JSON.stringify(resolve(appRoot, "node_modules/solid-js/web/dist/web.js"))};
  export { createSignal, createComponent } from ${JSON.stringify(resolve(appRoot, "node_modules/solid-js/dist/solid.js"))};
  export { Button, IconButton, Icon, Heading, ErrorMessage, Input, ActionMenu, Modal, Drawer, Notice, Status, Switch } from "@ui-lib";
  export { DeleteButton } from ${JSON.stringify(resolve(appRoot, "src/components/DeleteButton.jsx"))};
  export { OpenItemButton } from ${JSON.stringify(resolve(appRoot, "src/components/OpenItemButton.jsx"))};
  export { QuickRequestHistoryButton } from ${JSON.stringify(resolve(appRoot, "src/views/quick-requests/QuickRequestHistoryButton.jsx"))};
  export { AppNotice } from ${JSON.stringify(resolve(appRoot, "src/application/AppNotice.jsx"))};
  export { NoSelection } from ${JSON.stringify(resolve(appRoot, "src/application/NoSelection.jsx"))};
  export { DirectoriesLibraryForm } from ${JSON.stringify(resolve(appRoot, "src/views/directories/DirectoriesLibraryForm.jsx"))};
  export { RepositoryDirectories } from ${JSON.stringify(resolve(appRoot, "src/views/directories/RepositoryDirectories.jsx"))};
  export { NewWorkModal } from ${JSON.stringify(resolve(appRoot, "src/features/new-work/modal/NewWorkModal.jsx"))};
`,
);
try {
  await build({
    configFile: false,
    resolve: { alias: presentationAliases },
    root: appRoot,
    plugins: [solid()],
    build: {
      outDir: output,
      emptyOutDir: true,
      cssCodeSplit: false,
      lib: { entry, formats: ["es"], fileName: "ui-dom" },
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
  "HTMLDialogElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CustomEvent",
]) {
  globalThis[key] =
    key === "window"
      ? window
      : key === "document"
        ? window.document
        : window[key];
}
// happy-dom supplies real dialog elements but not the native modal methods.
window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

const {
  render,
  createSignal,
  createComponent,
  Button,
  IconButton,
  Icon,
  Heading,
  ErrorMessage,
  DeleteButton,
  QuickRequestHistoryButton,
  AppNotice,
  NoSelection,
  Input,
  ActionMenu,
  Modal,
  Drawer,
  Notice,
  Status,
  Switch,
  OpenItemButton,
  DirectoriesLibraryForm,
  RepositoryDirectories,
  NewWorkModal,
} = await import(pathToFileURL(join(output, "ui-dom.js")));
const component = (Component, props) => createComponent(Component, props);
function mount(componentFactory) {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(componentFactory, host);
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

test("Button and Input preserve native attributes, events, and input values", () => {
  let clicked = 0;
  const button = mount(() =>
    component(Button, {
      type: "submit",
      onClick: () => clicked++,
      children: "Save",
    }),
  );
  const nativeButton = button.host.querySelector("button");
  assert.equal(nativeButton.type, "submit");
  nativeButton.click();
  assert.equal(clicked, 1);
  button.dispose();

  const input = mount(() =>
    component(Input, {
      "aria-label": "Name",
      value: "Ada",
      onInput: (event) => {
        event.currentTarget.value = event.currentTarget.value.toUpperCase();
      },
    }),
  );
  const field = input.host.querySelector("input");
  assert.equal(field.getAttribute("aria-label"), "Name");
  assert.equal(field.value, "Ada");
  field.value = "grace";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(field.value, "GRACE");
  input.dispose();
});

test("IconButton requires an accessible label and preserves its action and icon", () => {
  let clicks = 0;
  const icon = document.createElement("svg");
  icon.setAttribute("aria-hidden", "true");
  const mounted = mount(() =>
    component(IconButton, {
      label: "Open Quick Request",
      onClick: () => clicks++,
      children: icon,
    }),
  );
  const button = mounted.host.querySelector("button");
  assert.equal(button.getAttribute("aria-label"), "Open Quick Request");
  assert.equal(button.title, "Open Quick Request");
  assert.ok(button.querySelector('svg[aria-hidden="true"]'));
  button.click();
  assert.equal(clicks, 1);
  mounted.dispose();
});

test("Switch is a labelled native binary control and OpenItemButton gives folder actions a shared name", () => {
  let checked = false;
  const mounted = mount(() => [
    component(Switch, {
      "aria-label": "Show archived tickets",
      checked,
      onChange: (event) => { checked = event.currentTarget.checked; },
    }),
    component(OpenItemButton, {
      itemType: "ticket",
      itemName: "Fix layout",
      title: "Read ticket",
      onClick: () => {},
    }),
  ]);
  const toggle = mounted.host.querySelector('input[role="switch"]');
  assert.equal(toggle.type, "checkbox");
  assert.equal(toggle.getAttribute("aria-label"), "Show archived tickets");
  toggle.checked = true;
  toggle.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(checked, true);
  const open = mounted.host.querySelector("button");
  assert.equal(open.getAttribute("aria-label"), "Open ticket: Fix layout");
  assert.equal(open.title, "Read ticket");
  assert.ok(open.querySelector('svg[aria-hidden="true"]'));
  mounted.dispose();
});

test("Quick Request history uses the shared icon button and opens history", () => {
  let opens = 0;
  const mounted = mount(() =>
    component(QuickRequestHistoryButton, { onShow: () => opens++ }),
  );
  const button = mounted.host.querySelector("button");
  assert.equal(button.id, "show-history");
  assert.equal(button.getAttribute("aria-label"), "See all Quick Requests");
  assert.equal(button.title, "See all Quick Requests");
  assert.ok(button.querySelector('svg[aria-hidden="true"]'));
  button.click();
  assert.equal(opens, 1);
  mounted.dispose();
});

test("Icon renders a decorative shared icon with an accessible-hidden contract", () => {
  const mounted = mount(() => component(Icon, { name: "list", muted: true }));
  const icon = mounted.host.querySelector("svg");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  assert.equal(icon.getAttribute("focusable"), "false");
  assert.equal(icon.getAttribute("viewBox"), "0 0 16 16");
  assert.ok(icon.querySelector("path[d]"));
  mounted.dispose();
});

test("Heading separates semantic level from its shared visual size", () => {
  const mounted = mount(() =>
    component(Heading, {
      level: 1,
      size: "page",
      id: "page-title",
      children: "Quick Requests",
    }),
  );
  const heading = mounted.host.querySelector("h1");
  assert.ok(heading);
  assert.equal(heading.id, "page-title");
  assert.equal(heading.textContent, "Quick Requests");
  assert.equal(
    heading.className.trim().split(/\s+/).length,
    2,
    "heading includes shared base and size classes",
  );
  mounted.dispose();
});

test("ErrorMessage is hidden when empty and announces present errors assertively", () => {
  const [message, setMessage] = createSignal("");
  const mounted = mount(() =>
    component(ErrorMessage, { message, placement: "banner", id: "page-error" }),
  );
  assert.equal(mounted.host.querySelector("#page-error"), null);
  setMessage("Could not load Directories.");
  const alert = mounted.host.querySelector("#page-error");
  assert.equal(alert.getAttribute("role"), "alert");
  assert.equal(alert.getAttribute("aria-live"), "assertive");
  assert.equal(alert.textContent, "Could not load Directories.");
  mounted.dispose();
});

test("AppNotice keeps its polite status announcement and updates its hidden state", () => {
  const [message, setMessage] = createSignal("");
  const mounted = mount(() => component(AppNotice, { message }));
  const notice = mounted.host.querySelector("#app-notice");
  assert.equal(notice.getAttribute("role"), "status");
  assert.equal(notice.getAttribute("aria-live"), "polite");
  assert.equal(notice.hidden, true);
  setMessage("Could not load workspaces.");
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, "Could not load workspaces.");
  setMessage("");
  assert.equal(notice.hidden, true);
  mounted.dispose();
});

test("NoSelection keeps its workspace prompt conditional on visibility and selection", () => {
  const [visible, setVisible] = createSignal(true);
  const [workspaceSelected, setWorkspaceSelected] = createSignal(false);
  const mounted = mount(() =>
    component(NoSelection, { visible, workspaceSelected }),
  );
  const emptyState = mounted.host.querySelector("#no-selection");
  assert.equal(emptyState.hidden, false);
  assert.equal(
    mounted.host.querySelector("#workspaces-unselected h1").textContent,
    "Select a Workspace, or choose New work to start.",
  );
  setWorkspaceSelected(true);
  assert.equal(mounted.host.querySelector("#workspaces-unselected"), null);
  assert.equal(emptyState.hidden, false);
  setVisible(false);
  assert.equal(emptyState.hidden, true);
  mounted.dispose();
});

test("DeleteButton provides consistent danger styling and app-specific accessible naming", () => {
  let clicks = 0;
  const mounted = mount(() =>
    component(DeleteButton, {
      itemName: "Quick Request: Plan",
      onClick: () => clicks++,
    }),
  );
  const button = mounted.host.querySelector("button");
  assert.equal(button.getAttribute("aria-label"), "Delete Quick Request: Plan");
  assert.equal(button.title, "Delete Quick Request: Plan");
  assert.ok(button.querySelector('svg[aria-hidden="true"]'));
  button.click();
  assert.equal(clicks, 1);
  mounted.dispose();
});

test("repository library edits save on blur without an explicit save button", () => {
  let path = "",
    saves = 0,
    toggled;
  const form = mount(() =>
    component(DirectoriesLibraryForm, {
      addingDirectories: () => false,
      path: () => "/old",
      status: () => "",
      onPathInput: (value) => {
        path = value;
      },
      onSave: () => saves++,
      onAddDirectories: () => {},
      onChoose: () => {},
    }),
  );
  const input = form.host.querySelector("#repository-library-path");
  input.value = "/new";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("blur"));
  assert.equal(path, "/new");
  assert.equal(saves, 1);
  assert.equal(form.host.querySelector("button[type=submit]"), null);
  assert.equal(form.host.textContent.includes("Save location"), false);
  form.dispose();

  const repository = { id: "repo", name: "Repo", repositoryPath: "/repo" };
  const list = mount(() =>
    component(RepositoryDirectories, {
      directories: () => [
        { path: "/", repositories: [{ repository, enabled: true }] },
      ],
      pendingRepositoryId: () => null,
      onToggleRepository: (repo, enabled) => {
        toggled = [repo, enabled];
      },
      onDeleteMany: async () => {},
    }),
  );
  const checkbox = list.host.querySelector("input");
  assert.equal(checkbox.checked, true);
  checkbox.click();
  assert.deepEqual(toggled, [repository, false]);
  list.dispose();
});

test("New work uses native dialog and adopted controls without taking over cancellation", () => {
  let prompt = "",
    cancelled = 0,
    submitted = 0;
  const proposal = {
    workType: "workspace",
    title: "Review",
    originalPrompt: "original",
    createLabel: "Create",
  };
  const props = {
    setModal: () => {},
    proposal: () => proposal,
    captureVisible: () => true,
    reviewVisible: () => false,
    workType: () => "workspace",
    preview: () => "Rendered prompt with context",
    onPreviewToggle: () => {},
    prompt: () => "",
    setPrompt: (value) => {
      prompt = value;
    },
    onCancel: () => cancelled++,
    onCapture: (event) => {
      event.preventDefault();
      submitted++;
    },
    onEnterToSubmit: () => {},
    progressVisible: () => false,
    progressRows: () => [],
    captureError: () => "",
    captureDisabled: () => false,
    workspaceName: () => "",
    setWorkspaceName: () => {},
    startingPrompt: () => "",
    setStartingPrompt: () => {},
    directoryId: () => "",
    onDirectoryChange: () => {},
    directories: () => [],
    directoryPath: () => "",
    proposalModelDisabled: () => false,
    proposalSelectedModel: () => "",
    setProposalSelectedModel: () => {},
    proposalModels: () => [],
    onBack: () => {},
    onConfirm: () => {},
    proposalCreateDisabled: () => false,
    proposalError: () => "",
  };
  const mounted = mount(() => component(NewWorkModal, props));
  const preview = mounted.host.querySelector("#proposal-prompt-preview");
  assert.equal(preview.open, false);
  assert.ok(
    preview.compareDocumentPosition(
      mounted.host.querySelector("#new-work-prompt"),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.equal(
    preview.querySelector("summary").textContent,
    "Proposal prompt preview",
  );
  assert.equal(
    preview.querySelector("summary svg").getAttribute("aria-hidden"),
    "true",
  );
  preview.open = true;
  assert.equal(
    preview.querySelector("pre").textContent,
    "Rendered prompt with context",
  );
  assert.equal(preview.querySelector("pre").parentElement.tabIndex, 0);
  assert.ok(mounted.host.querySelector("dialog"));
  mounted.host
    .querySelector("dialog")
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  assert.equal(cancelled, 0);
  const field = mounted.host.querySelector("#new-work-prompt");
  field.value = "  unchanged  ";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  mounted.host
    .querySelector("#new-work-capture")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  mounted.host.querySelector("#new-work-cancel").click();
  assert.equal(prompt, "  unchanged  ");
  assert.equal(submitted, 1);
  assert.equal(cancelled, 1);
  const dialog = mounted.host.querySelector("dialog");
  assert.equal(dialog.getAttribute("aria-labelledby"), "new-work-title");
  assert.equal(
    mounted.host.querySelector("#new-work-title").textContent,
    "New Workspace",
  );
  const submit = mounted.host.querySelector('button[type="submit"]');
  assert.equal(submit.form, mounted.host.querySelector("#new-work-capture"));
  assert.equal(
    mounted.host.querySelector("#new-work-error"),
    null,
    "Empty errors do not reserve footer space",
  );
  mounted.host.querySelector('[aria-label="Close dialog"]').click();
  assert.equal(cancelled, 2, "Header close uses the same caller-owned cleanup");
  const cancel = new Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(cancelled, 3, "Escape uses the same caller-owned cleanup");
  mounted.dispose();
});

test("ActionMenu uses its accessible label as the native disclosure trigger", async () => {
  const states = [];
  const mounted = mount(() =>
    component(ActionMenu, {
      label: "Actions",
      onToggle: (open) => states.push(open),
      children: "Run",
    }),
  );
  const details = mounted.host.querySelector("details");
  assert.equal(details.open, false);
  assert.equal(mounted.host.querySelector("summary").textContent, "Actions");
  assert.equal(
    mounted.host.querySelector("summary").getAttribute("aria-label"),
    "Actions",
  );
  assert.equal(
    mounted.host.querySelector('[role="group"]').getAttribute("aria-label"),
    "Actions",
  );
  details.open = true;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(states, [true]);
  mounted.dispose();
});

for (const [name, Component] of [
  ["Modal", Modal],
  ["Drawer", Drawer],
]) {
  test(`${name} follows controlled open state and requests close without owning it`, () => {
    const [open, setOpen] = createSignal(false);
    let requests = 0;
    const mounted = mount(() =>
      component(Component, {
        get open() {
          return open();
        },
        title: "Details",
        titleId: "details-title",
        onCloseRequest: () => requests++,
        children: "Body",
      }),
    );
    const dialog = mounted.host.querySelector("dialog");
    assert.equal(dialog.open, false);
    setOpen(true);
    assert.equal(dialog.open, true);
    assert.equal(dialog.getAttribute("aria-labelledby"), "details-title");
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(requests, 1);
    assert.equal(dialog.open, true);
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    assert.equal(requests, 1);
    setOpen(false);
    assert.equal(dialog.open, false);
    mounted.dispose();
  });
}

test("Notice and Status remain available through the UI entry and react to messages", () => {
  const [message, setMessage] = createSignal("Saved");
  const mounted = mount(() =>
    component(Notice, {
      get message() {
        return message();
      },
    }),
  );
  assert.equal(
    mounted.host.querySelector('[role="status"]').textContent,
    "Saved",
  );
  setMessage("Updated");
  assert.equal(
    mounted.host.querySelector('[role="status"]').textContent,
    "Updated",
  );
  setMessage("");
  assert.equal(mounted.host.querySelector('[role="status"]'), null);
  mounted.dispose();

  const status = mount(() =>
    component(Status, {
      label: "Session status",
      get children() {
        return message();
      },
    }),
  );
  setMessage("Running");
  assert.equal(
    status.host.querySelector('[aria-label="Session status"]').textContent,
    "Running",
  );
  status.dispose();
});
