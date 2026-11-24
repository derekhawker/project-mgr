import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { build } from "vite";
import solid from "vite-plugin-solid";
import { presentationAliases } from "../vite.config.js";

// Run the real entry, command contracts, feature controllers and Solid tree.
// The browser command transport and terminal renderer are fixtures: no live
// processes, user directories, network services or application data are used.
test("application composes, saves new ticket labels through the Rust boundary, and retains terminals", async () => {
  const root = resolve(import.meta.dirname, "..");
  const temp = await mkdtemp("/tmp/opencode/application-composition-");
  const window = new Window();
  const previous = new Map();
  const globals = [
    "window",
    "self",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "customElements",
    "CSSStyleSheet",
    "HTMLHeadElement",
    "Event",
    "MouseEvent",
    "__quickRequestCreateCalls",
    "__quickRequestCreatePrompts",
    "__rejectQuickRequestCreate",
    "__deferWorkspaceTicketWork",
    "__resolveWorkspaceTicketWork",
    "__workspaceTicketWorkSettled",
    "__ticketLabelSetCalls",
    "__workspaceCreateCalls",
  ];
  try {
    const terminal = join(temp, "terminal.js");
    const quickRequestFixture = join(temp, "quick-request-fixture.js");
    await writeFile(
      terminal,
      `
      export class TerminalRuntime {
        constructor(options) {
          this.options = options;
          this.attached = [];
          this.forgotten = [];
          this.restarted = [];
          this.exited = new Set();
        }
        async start() {}
        async attachExisting(id, container) {
          this.attached.push(id);
          container.textContent = "Fixture terminal " + id;
        }
        select(id, { focus = true } = {}) {
          if (focus) document.getElementById("terminal-" + id)?.focus();
        }
        reopen() {}
        isExited(id) { return this.exited.has(id); }
        exit(id) { this.exited.add(id); this.options.onExit({sessionId: id}); }
        async restart(id, directory, container) { this.restarted.push({id, directory, container}); }
        async suspendResizing() {}
        forget(id) { this.forgotten.push(id); }
        dispose() {}
      }
    `,
    );
    await writeFile(
      quickRequestFixture,
      `
      import { invokeBrowserFixture as invoke } from ${JSON.stringify(resolve(root, "src/fixtures/browserFixture.js"))};
      let calls = 0;
      export function invokeBrowserFixture(name, payload) {
        if (name === "workspace_create") {
          globalThis.__workspaceCreateCalls.push(structuredClone(payload));
        }
        if (name === "workspace_ticket_label_set") {
          globalThis.__ticketLabelSetCalls.push(structuredClone(payload));
        }
        if (name === "workspace_ticket_work" && globalThis.__deferWorkspaceTicketWork) {
          return new Promise((resolve, reject) => {
            globalThis.__resolveWorkspaceTicketWork = () => {
              invoke(name, payload).then((result) => {
                globalThis.__workspaceTicketWorkSettled = true;
                resolve(result);
              }, reject);
            };
          });
        }
        if (name === "quick_request_create") {
          calls++;
          globalThis.__quickRequestCreateCalls = calls;
          globalThis.__quickRequestCreatePrompts.push(
            payload.request.startingPrompt || payload.request.prompt,
          );
          if (calls === 1) return new Promise((_, reject) => { globalThis.__rejectQuickRequestCreate = reject; });
        }
        return invoke(name, payload);
      }
      `,
    );
    await build({
      configFile: false,
      resolve: { alias: presentationAliases },
      root,
      plugins: [
        {
          name: "terminal-renderer-fixture",
          enforce: "pre",
          resolveId(source, importer) {
            if (source === "./terminal/terminalRuntime.js") return terminal;
            if (
              importer !== quickRequestFixture &&
              source.endsWith("fixtures/browserFixture.js")
            )
              return quickRequestFixture;
          },
        },
        solid(),
      ],
      define: { "import.meta.env.DEV": "true" },
      logLevel: "silent",
      build: {
        minify: false,
        outDir: join(temp, "out"),
        lib: {
          entry: resolve(root, "src/main.js"),
          formats: ["es"],
          fileName: "application",
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });
    for (const key of globals) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value:
          key === "window" || key === "self"
            ? window
            : key === "document"
              ? window.document
              : window[key],
      });
    }
    window.document.body.innerHTML = '<div id="app-root"></div>';
    window.HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    window.HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    const { terminalRuntime } = await import(
      pathToFileURL(join(temp, "out/application.js"))
    );
    const runtime = await terminalRuntime;
    const $ = (selector) => {
      const element = window.document.querySelector(selector);
      assert.ok(element, `Missing ${selector}`);
      return element;
    };
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 3000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, "Application update timed out");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const input = (selector, value) => {
      const field = $(selector);
      field.value = value;
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    globalThis.__quickRequestCreateCalls = 0;
    globalThis.__quickRequestCreatePrompts = [];
    globalThis.__deferWorkspaceTicketWork = false;
    globalThis.__workspaceTicketWorkSettled = false;
    globalThis.__ticketLabelSetCalls = [];
    globalThis.__workspaceCreateCalls = [];

    await waitFor(
      () => $("#workspace-list").getAttribute("aria-busy") === "false",
    );

    // Exercise the complete UI-to-Rust-boundary flow: right-click a ticket,
    // create a new label, apply it, and confirm navigation reflects the save.
    const labelTicket = () =>
      [...$("#workspace-list").querySelectorAll("button")].find((button) =>
        button.textContent.includes("Example active ticket"),
      );
    labelTicket().dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 240,
        clientY: 180,
      }),
    );
    await waitFor(() =>
      window.document.querySelector("[role='menu'] [role='menuitem']"),
    );
    $("[role='menuitem']").click();
    await waitFor(() => window.document.querySelector("dialog[open]"));
    assert.equal(
      $("dialog[open] input[aria-label='Current label']").readOnly,
      true,
    );
    assert.equal(
      $("dialog[open] input[aria-label='Current label']").value,
      "Example Workspace",
    );
    assert.equal(
      window.document.querySelector("dialog[open] [role='listbox']"),
      null,
    );
    input(
      'dialog[open] input[aria-label="Search labels"]',
      "Cross-workspace rollout",
    );
    const createLabel = () =>
      [...$("dialog[open]").querySelectorAll('[role="option"]')].find(
        (option) =>
          option.textContent.includes("Create “Cross-workspace rollout”"),
      );
    await waitFor(createLabel);
    createLabel().click();
    assert.equal(
      window.document.querySelector("dialog[open] [role='listbox']"),
      null,
    );
    assert.equal(
      $("dialog[open] input[aria-label='Search labels']").value,
      "Cross-workspace rollout",
    );
    const applyLabel = () =>
      [...$("dialog[open]").querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "Apply label",
      );
    if (!applyLabel()) throw new Error("Missing Apply label action");
    applyLabel().click();
    await waitFor(() => globalThis.__ticketLabelSetCalls.length === 1);
    await waitFor(() => !window.document.querySelector("dialog[open]"));
    assert.deepEqual(globalThis.__ticketLabelSetCalls, [
      {
        request: {
          workspaceId: "fixture-workspace",
          filename: "example-active.md",
          label: "Cross-workspace rollout",
        },
      },
    ]);

    labelTicket().dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 240,
        clientY: 180,
      }),
    );
    await waitFor(() => window.document.querySelector("[role='menuitem']"));
    $("[role='menuitem']").click();
    await waitFor(() =>
      window.document.querySelector(
        "dialog[open] input[aria-label='Current label']",
      ),
    );
    assert.equal(
      $("dialog[open] input[aria-label='Current label']").value,
      "Cross-workspace rollout",
    );
    assert.equal(
      $("dialog[open] input[aria-label='Current label']").readOnly,
      true,
    );
    [...$("dialog[open]").querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Cancel")
      .click();

    assert.equal($("#workspace-shell").hidden, true);
    const ticketSessionId =
      "fixture-ticket-work-fixture-workspace-example-active.md";
    const ticketTerminalId = `terminal-${ticketSessionId}`;
    $("#workspace-list button").click();
    const activeTicket = () =>
      [...$("#workspace-list").querySelectorAll("button")].find((button) =>
        button.textContent.includes("Example active ticket"),
      );
    await waitFor(activeTicket);
    assert.equal(window.document.getElementById(ticketTerminalId), null);
    activeTicket().click();
    await waitFor(() => window.document.getElementById(ticketTerminalId));
    const host = $("#terminal-views");
    const workspaceTerminal = window.document.getElementById(ticketTerminalId);
    const workspaceHeading = $("#workspace-shell h1");
    assert.deepEqual(
      [...workspaceHeading.children]
        .slice(0, 3)
        .map((part) => part.textContent),
      ["Workspace", "/", "Example Workspace"],
    );

    runtime.exit(ticketSessionId);
    const restart = $(`[data-restart-session="${ticketSessionId}"]`);
    assert.equal(restart.hidden, false);
    restart.click();
    await waitFor(
      () => $(`[data-restart-session="${ticketSessionId}"]`).hidden,
    );
    assert.deepEqual(runtime.restarted, [
      {
        id: ticketSessionId,
        directory: "/fixture/fixture-workspace",
        container: workspaceTerminal,
      },
    ]);

    $('[aria-label="Open ports"]').click();
    await waitFor(() => window.document.querySelector('[aria-label="Ports"]'));
    assert.equal(workspaceTerminal.isConnected, true);
    activeTicket().click();
    await waitFor(() => !$("#selected-owner").hidden);
    assert.equal(window.document.querySelector('[aria-label="Ports"]'), null);
    assert.equal(
      window.document.getElementById(ticketTerminalId),
      workspaceTerminal,
    );

    $("#show-repo-tools").click();
    const toolAction = () =>
      [...$("#repo-tools-menu").querySelectorAll("button")].find(
        (button) => button.textContent === "test · repository root",
      );
    await waitFor(toolAction);
    toolAction().click();
    await waitFor(() =>
      window.document.getElementById("session-tab-fixture-tool-1"),
    );
    const toolTab = $("#session-tab-fixture-tool-1");
    const attachments = [...runtime.attached];
    await waitFor(() => !$("#show-docs").disabled);
    $("#show-docs").focus();
    $("#show-docs").click();
    await waitFor(() => !$("#docs-page").hidden && !$("#show-docs").disabled);
    assert.equal($("#show-docs").getAttribute("aria-selected"), "true");
    assert.equal($("#workspace-shell").hidden, false);
    assert.equal($("#workspace-shell h1"), workspaceHeading);
    assert.equal(window.document.activeElement, $("#show-docs"));
    assert.equal(toolTab.getAttribute("aria-selected"), "false");
    assert.equal($("#terminal-views"), host);
    assert.equal(
      window.document.getElementById(ticketTerminalId),
      workspaceTerminal,
    );
    assert.deepEqual(
      runtime.attached,
      attachments,
      "Docs never reattaches terminals",
    );
    assert.equal(runtime.forgotten.length, 0, "Docs never closes terminals");
    $("#show-docs").dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    );
    await waitFor(() => !$("#selected-owner").hidden);
    assert.equal(
      window.document.activeElement?.id,
      `session-tab-${ticketSessionId}`,
    );
    assert.equal($("#show-docs").getAttribute("aria-selected"), "false");
    assert.deepEqual(runtime.attached, attachments);
    $("#show-change-review").click();
    await waitFor(
      () =>
        !$("#change-review-page").hidden && !$("#show-change-review").disabled,
    );
    $('[role="switch"]').click();
    assert.equal($('[role="switch"]').checked, true);
    await waitFor(() => !$("#show-docs").disabled);
    $("#show-docs").click();
    await waitFor(() => !$("#docs-page").hidden);
    $("#show-change-review").click();
    await waitFor(() => !$("#change-review-page").hidden);
    assert.equal($('[role="switch"]').checked, true);
    window.document.getElementById(`session-tab-${ticketSessionId}`).click();
    $('[aria-label="Close Example repository · Fixture test"]').click();
    await waitFor(
      () => !window.document.getElementById("session-tab-fixture-tool-1"),
    );
    assert.ok(runtime.forgotten.includes("fixture-tool-1"));
    assert.equal(
      window.document
        .getElementById(`session-tab-${ticketSessionId}`)
        .getAttribute("aria-selected"),
      "true",
    );

    $("#show-directories").click();
    await waitFor(() => !$("#directories-page").hidden);
    assert.equal($("#workspace-shell").hidden, true);
    assert.equal($("#terminal-views"), host);
    $("#workspace-list button").click();
    await waitFor(activeTicket);
    activeTicket().click();
    await waitFor(
      () => !workspaceTerminal.hidden && !$("#selected-owner").hidden,
    );
    assert.equal(
      window.document.getElementById(ticketTerminalId),
      workspaceTerminal,
    );

    $("#show-history").click();
    await waitFor(() => {
      const history = window.document.querySelector("#quick-request-full-list");
      return history && !history.hidden;
    });
    $(
      '#quick-request-full-list button[aria-label^="Open Quick Request:"]',
    ).click();
    await waitFor(() =>
      window.document.getElementById("terminal-session-fixture-quick-seeded"),
    );
    const quickTerminal = $("#terminal-session-fixture-quick-seeded");
    assert.equal($("#workspace-shell").hidden, true);
    assert.deepEqual(
      [...$("#quick-request-title").children]
        .slice(0, 3)
        .map((part) => part.textContent),
      ["Quick Request", "/", "Fixture Quick Request"],
    );
    activeTicket().click();
    await waitFor(() => !$("#selected-owner").hidden);
    assert.equal(window.document.querySelector("#quick-request-title"), null);
    assert.equal(quickTerminal.isConnected, true);
    $("#show-history").click();
    await waitFor(() => {
      const history = window.document.querySelector("#quick-request-full-list");
      return history && !history.hidden;
    });
    assert.equal(quickTerminal.isConnected, true);

    // Cancel leaves the current destination and terminal untouched.
    $('[data-new-work-type="quick_request"]').click();
    input("#new-work-prompt", "Cancelled fixture prompt");
    $("#new-work-cancel").click();
    assert.equal($("#new-work-modal").open, false);
    assert.equal(quickTerminal.isConnected, true);

    $('[data-new-work-type="quick_request"]').click();
    assert.equal($("#new-work-prompt").value, "");
    const originalPrompt = "  A quick fixture prompt\n";
    input("#new-work-prompt", originalPrompt);
    $("#new-work-capture").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => !$("#new-work-review").hidden);
    await waitFor(() => !$("#proposal-create").disabled);
    [...window.document.querySelectorAll('[role="tab"]')]
      .find((tab) => tab.textContent === "Suggested")
      .click();
    input("#quick-request-directory", "");
    assert.equal($("#proposal-create").disabled, true);
    input("#quick-request-directory", "/fixture/custom-working-directory");
    assert.equal($("#proposal-create").disabled, false);
    assert.equal(
      $("#quick-request-prompt-suggested").value,
      `Clarify this Quick Request: ${originalPrompt}`,
    );
    $("#proposal-create").click();
    await waitFor(() => globalThis.__quickRequestCreateCalls === 1);
    assert.equal($("#proposal-create").disabled, true);
    $("#proposal-create").click();
    assert.equal(globalThis.__quickRequestCreateCalls, 1);
    globalThis.__rejectQuickRequestCreate(
      new Error("Deferred creation failed"),
    );
    await waitFor(() =>
      window.document
        .querySelector("#proposal-error")
        ?.textContent.includes("Deferred creation failed"),
    );
    assert.equal(
      $("#quick-request-prompt-suggested").value,
      `Clarify this Quick Request: ${originalPrompt}`,
    );
    assert.equal($("#proposal-create").disabled, false);
    $("#proposal-create").click();
    await waitFor(() => !$("#new-work-modal").open);
    assert.equal(globalThis.__quickRequestCreateCalls, 2);
    assert.equal(
      globalThis.__quickRequestCreatePrompts[1],
      `Clarify this Quick Request: ${originalPrompt}`,
    );
    assert.match(
      $("#quick-request-list").textContent,
      /A quick fixture prompt/,
    );
    $("#show-history").click();
    await waitFor(() => {
      const history = window.document.querySelector("#quick-request-full-list");
      return history && !history.hidden;
    });

    $('[data-new-work-type="workspace"]').click();
    assert.equal($("#new-work-modal").open, true);
    await waitFor(() => !$("#workspace-repository-select").disabled);
    $("#workspace-repository-select").click();
    $('[data-value="fixture-repo"]').click();
    input("#workspace-create-name", "Composition Workspace");
    $("#workspace-create-form").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => !$("#new-work-modal").open);
    assert.deepEqual(globalThis.__workspaceCreateCalls, [
      {
        request: {
          name: "Composition Workspace",
          description: null,
          repositoryId: "fixture-repo",
        },
      },
    ]);
    assert.match($("#workspace-list").textContent, /Composition Workspace/);
    assert.equal($("#workspace-shell").hidden, true);
    assert.equal($("#workspace-shell h1"), workspaceHeading);
    assert.equal(
      workspaceHeading.children[2].textContent,
      "Composition Workspace",
    );
    assert.equal($("#terminal-views"), host);
    assert.equal(workspaceTerminal.isConnected, true);
    assert.equal(quickTerminal.isConnected, true);
    assert.equal(
      runtime.attached.filter((id) => id === ticketSessionId).length,
      1,
    );
    assert.equal(window.document.querySelectorAll("#terminal-views").length, 1);

    globalThis.__deferWorkspaceTicketWork = true;
    activeTicket().click();
    $('[aria-label="Open ports"]').click();
    await waitFor(() => window.document.querySelector('[aria-label="Ports"]'));
    globalThis.__resolveWorkspaceTicketWork();
    await waitFor(() => globalThis.__workspaceTicketWorkSettled);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(window.document.querySelector('[aria-label="Ports"]'));
  } finally {
    window.dispatchEvent(new window.Event("pagehide"));
    await window.happyDOM.abort();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    await rm(temp, { recursive: true, force: true });
  }
});
