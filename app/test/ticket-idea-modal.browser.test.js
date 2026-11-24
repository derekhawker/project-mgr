import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

test("ticket idea modal preserves its shell and resets content on close", async (t) => {
  const root = resolve(import.meta.dirname, "..");
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((done) => socket.close(done));
  const server = spawn(
    process.execPath,
    [
      resolve(root, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: root, stdio: "ignore" },
  );
  const session = `ticket-modal-lifetime-${process.pid}`;
  const browser = (...args) => {
    const result = spawnSync("agent-browser", ["--session", session, ...args], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  const evaluate = (js) => JSON.parse(browser("eval", js));
  t.after(async () => {
    try {
      browser("close");
    } finally {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
  });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (true) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // Starting Vite.
    }
    assert.ok(Date.now() < deadline, "Vite starts within 15 seconds");
    await new Promise((done) => setTimeout(done, 100));
  }

  browser("open", url);
  browser("find", "role", "button", "click", "--name", "Example Workspace");
  browser("wait", "#workspace-ticket-title");
  browser(
    "wait",
    "--fn",
    `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Create ticket'); return button && !button.disabled; })()`,
  );

  const open = () =>
    browser("find", "role", "button", "click", "--name", "Create ticket");
  open();
  browser("wait", "#ticket-idea");
  const first = evaluate(`(() => {
    window.__ticketModalShell = document.querySelector('dialog:not(#new-work-modal)');
    window.__ticketIdea = document.querySelector('#ticket-idea');
    return { open: window.__ticketModalShell?.open, value: window.__ticketIdea?.value };
  })()`);
  assert.equal(first.open, true);
  assert.equal(first.value, "");
  browser("fill", "#ticket-idea", "A transient idea");
  assert.equal(evaluate("window.__ticketModalShell.isConnected"), true);
  browser(
    "click",
    'dialog:not(#new-work-modal) button[aria-label="Close dialog"]',
  );
  browser("wait", "--fn", "!window.__ticketModalShell.open");
  browser("wait", "--fn", "!document.querySelector('#ticket-idea')");
  assert.equal(evaluate("window.__ticketModalShell.isConnected"), true);

  open();
  browser("wait", "#ticket-idea");
  assert.deepEqual(
    evaluate(`({
      sameShell: document.querySelector('dialog:not(#new-work-modal)') === window.__ticketModalShell,
      freshContent: document.querySelector('#ticket-idea') !== window.__ticketIdea,
      value: document.querySelector('#ticket-idea').value,
    })`),
    { sameShell: true, freshContent: true, value: "" },
  );
  browser("fill", "#ticket-idea", "Escape should discard this too");
  browser("press", "Escape");
  browser("wait", "--fn", "!window.__ticketModalShell.open");
  browser("wait", "--fn", "!document.querySelector('#ticket-idea')");
  open();
  browser("wait", "#ticket-idea");
  assert.equal(evaluate("document.querySelector('#ticket-idea').value"), "");

  evaluate("(window.__deferWorkspaceTicketProposal = true)");
  browser("fill", "#ticket-idea", "A proposal that will finish after close");
  browser("find", "role", "button", "click", "--name", "Review proposal");
  browser(
    "wait",
    "--fn",
    "typeof window.__resolveWorkspaceTicketProposal === 'function'",
  );
  browser("find", "role", "button", "click", "--name", "Cancel");
  browser("wait", "--fn", "!window.__ticketModalShell.open");
  evaluate(
    "(() => { window.__resolveWorkspaceTicketProposal(); window.__deferWorkspaceTicketProposal = false; return true; })()",
  );
  open();
  browser("wait", "#ticket-idea");
  assert.equal(evaluate("document.querySelector('#ticket-idea').value"), "");
  assert.equal(
    evaluate("document.querySelector('#ticket-title') === null"),
    true,
  );
  browser("find", "role", "button", "click", "--name", "Cancel");
});
