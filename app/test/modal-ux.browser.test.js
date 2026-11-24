import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

test("New Work keeps its modal shell and creates fresh open-scoped content", async (t) => {
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
  const session = `modal-lifetime-${process.pid}`;
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
  const open = (type) => {
    browser("click", "#new-work-menu summary");
    browser("click", `[data-new-work-type="${type}"]`);
    browser("wait", "--fn", "document.querySelector('#new-work-modal').open");
    browser("wait", "#new-work-modal-content");
  };
  const closeAndCheckContentDisposed = async (closeAction) => {
    const content = evaluate(
      "(() => { window.__modalContentBeforeClose = document.querySelector('#new-work-modal-content'); return true; })()",
    );
    assert.equal(content, true);
    closeAction();
    browser("wait", "--fn", "!document.querySelector('#new-work-modal').open");
    browser(
      "wait",
      "--fn",
      "document.activeElement.matches('#new-work-menu summary')",
    );
    assert.deepEqual(
      evaluate(`(() => ({
        shellSame: document.querySelector('#new-work-modal') === window.__modalShell,
        contentGone: !document.querySelector('#new-work-modal-content'),
        previousContentDetached: !window.__modalContentBeforeClose.isConnected,
      }))()`),
      { shellSame: true, contentGone: true, previousContentDetached: true },
    );
  };

  open("workspace");
  assert.equal(
    evaluate(
      `(() => { window.__modalShell = document.querySelector('#new-work-modal'); return window.__modalShell.open; })()`,
    ),
    true,
  );
  await t.test("backdrop does not dismiss and focus stays in the modal", () => {
    browser("mouse", "move", "4", "4");
    browser("mouse", "down");
    browser("mouse", "up");
    assert.equal(
      evaluate("document.querySelector('#new-work-modal').open"),
      true,
    );
    browser("focus", "#workspace-repository-select");
    browser("press", "Shift+Tab");
    browser("press", "Shift+Tab");
    assert.equal(
      evaluate(
        "document.querySelector('#new-work-modal').contains(document.activeElement)",
      ),
      true,
    );
  });
  await closeAndCheckContentDisposed(() =>
    browser("click", "#workspace-cancel"),
  );

  open("quick_request");
  assert.equal(
    evaluate("document.querySelector('#new-work-prompt').value"),
    "",
  );
  browser("fill", "#new-work-prompt", "Transient modal prompt");
  await closeAndCheckContentDisposed(() => browser("press", "Escape"));

  open("quick_request");
  assert.equal(
    evaluate("document.querySelector('#new-work-prompt').value"),
    "",
    "reopening creates fresh content state",
  );
  await closeAndCheckContentDisposed(() =>
    browser("click", "#new-work-cancel"),
  );
});
