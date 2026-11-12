import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
function browser(session, ...args) {
  const result = spawnSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8", timeout: 30000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

test("workspace list scrolls independently while quick heading and bottom destinations stay visible", async (t) => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((done) => socket.close(done));
  const url = `http://127.0.0.1:${port}/?navigationOverflow`;
  const session = `navigation-scroll-${process.pid}`;
  const server = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
  t.after(async () => {
    try { browser(session, "close"); } catch {}
    server.kill("SIGTERM");
    if (server.exitCode === null) await once(server, "exit");
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(Date.now() < deadline, "Vite must start");
  browser(session, "set", "viewport", "1024", "600");
  browser(session, "open", url);
  browser(session, "wait", "--fn", "document.querySelectorAll('#workspace-list li').length >= 30 && document.querySelectorAll('#quick-request-list li').length >= 30");
  const result = JSON.parse(browser(session, "eval", `(() => {
    const nav = document.querySelector('.navigation');
    const scroll = document.querySelector('.navigation-scroll');
    const qr = document.querySelector('.quick-section-heading');
    const ws = document.querySelector('.navigation-heading');
    const buttons = [document.querySelector('#show-directories'), document.querySelector('[aria-label="Open ports"]'), document.querySelector('#new-work-menu button')];
    const box = el => { const r = el.getBoundingClientRect(); return {top:r.top,bottom:r.bottom}; };
    const snapshot = () => ({scroll:scroll.scrollTop, viewport:box(nav), qr:box(qr), ws:box(ws), buttons:buttons.map(box)});
    const initial = snapshot();
    scroll.scrollTop = 200;
    const requests = snapshot();
    scroll.scrollTop = ws.offsetTop + 200;
    const workspaces = snapshot();
    scroll.scrollTop = scroll.scrollHeight;
    const end = snapshot();
    return {initial, requests, workspaces, end, overflow: scroll.scrollHeight > scroll.clientHeight, heading: document.querySelector('.quick-section-heading h3')?.textContent.trim(), diagnostics: !!document.querySelector('.navigation-diagnostics')};
  })()`));
  assert.ok(result.overflow, "workspace list must overflow its scroll area");
  assert.equal(result.heading, "Quick Requests", "the section heading stays visible beside the chevron");
  assert.equal(result.diagnostics, false, "Navigation diagnostics are not rendered");
  for (const state of [result.initial, result.requests, result.workspaces, result.end]) {
    for (const button of state.buttons) {
      assert.ok(button.top >= state.viewport.top && button.bottom <= state.viewport.bottom, `bottom actions must remain visible: ${JSON.stringify(state)}`);
      assert.ok(Math.abs(button.top - result.initial.buttons[state.buttons.indexOf(button)].top) < 2, `bottom actions must remain anchored: ${JSON.stringify(state)}`);
    }
  }
  assert.ok(result.requests.scroll > 0 && Math.abs(result.requests.qr.top - result.initial.qr.top) < 2, `Quick Requests heading must stay visible: ${JSON.stringify(result)}`);
  assert.ok(Math.abs(result.workspaces.ws.top - result.initial.ws.top) < 2, `Workspaces heading must stay visible: ${JSON.stringify(result)}`);
  assert.ok(result.end.scroll > result.workspaces.scroll, "last workspace must be reachable");
});
