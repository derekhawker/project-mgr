import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

test("Ports and Quick Request routes yield to ticket work without replacing terminals", async (t) => {
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
  const session = `right-pane-routing-${process.pid}`;
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
  browser(
    "wait",
    "--fn",
    `document.querySelector('#workspace-list')?.getAttribute('aria-busy') === 'false'`,
  );
  browser("find", "role", "button", "click", "--name", "Example Workspace");
  browser("wait", "#workspace-ticket-title");
  browser("click", '[aria-label="Open ports"]');
  browser("wait", '[aria-label="Ports"]');
  evaluate(
    "(() => { window.__terminalHost = document.querySelector('#terminal-views'); return true; })()",
  );
  browser("find", "text", "Example active ticket", "click");
  browser("wait", "--fn", `!document.querySelector('#selected-owner')?.hidden`);
  browser("wait", "--fn", `!document.querySelector('[aria-label="Ports"]')`);
  const terminalState = evaluate(`(() => {
    window.__terminalState = {
      nodes: [...document.querySelector('#terminal-views').children],
      ids: [...document.querySelector('#terminal-views').children].map((node) => node.id),
      activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.id || null,
    };
    return { count: window.__terminalState.nodes.length, activeTab: window.__terminalState.activeTab };
  })()`);
  assert.ok(terminalState.count > 0, "ticket Work mounted a terminal surface");
  assert.ok(terminalState.activeTab, "ticket session tab is selected");
  assert.equal(
    evaluate(
      "document.querySelector('#terminal-views') === window.__terminalHost",
    ),
    true,
  );

  browser("click", "#quick-request-list button");
  browser("wait", "#quick-request-title");
  browser("find", "text", "Example active ticket", "click");
  browser("wait", "--fn", `!document.querySelector('#selected-owner')?.hidden`);
  browser("wait", "--fn", `!document.querySelector('#quick-request-title')`);
  const continuity = evaluate(`({
      currentIds: [...document.querySelector('#terminal-views').children].map((node) => node.id),
      previousIds: window.__terminalState.ids,
      sameNodes: window.__terminalState.nodes.every((node) => [...document.querySelector('#terminal-views').children].includes(node)),
      sameIds: window.__terminalState.ids.every((id) => [...document.querySelector('#terminal-views').children].some((node) => node.id === id)),
      sameActiveTab: (document.querySelector('[role="tab"][aria-selected="true"]')?.id || null) === window.__terminalState.activeTab,
    })`);
  assert.deepEqual(
    (({ currentIds, previousIds, ...result }) => result)(continuity),
    { sameNodes: true, sameIds: true, sameActiveTab: true },
    JSON.stringify(continuity),
  );
  assert.equal(
    evaluate(
      "document.querySelector('#terminal-views') === window.__terminalHost",
    ),
    true,
  );
});
