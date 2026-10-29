import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
function browser(session, ...args) {
  const result = spawnSync("agent-browser", ["--session", session, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

test("readers keep gutters aligned and wide tables readable", async (t) => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((done) => socket.close(done));
  const url = `http://127.0.0.1:${port}/`;
  const session = `reader-layout-${process.pid}`;
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
  t.after(async () => {
    try {
      browser(session, "close");
    } catch {}
    server.kill("SIGTERM");
    if (server.exitCode === null) await once(server, "exit");
  });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(Date.now() < deadline, "Vite must start");
  browser(session, "open", url);
  browser(
    session,
    "find",
    "role",
    "button",
    "click",
    "--name",
    "Example Workspace",
  );
  browser(session, "find", "role", "tab", "click", "--name", "Change Review");
  browser(
    session,
    "wait",
    "--fn",
    "!!document.querySelector('.d2h-code-line-ctn')",
  );
  const result = JSON.parse(
    browser(
      session,
      "eval",
      `(() => {
    const pane = document.querySelector('.change-review-diff-pane');
    const body = document.querySelector('.d2h-diff-tbody');
    const row = body.querySelectorAll('tr')[1];
    for (let i = 0; i < 100; i++) body.append(row.cloneNode(true));
    const gutter = row.querySelector('td:first-child');
    const text = row.querySelector('.d2h-code-line-ctn');
    text.textContent = 'longword'.repeat(120);
    const contentWidth = text.getBoundingClientRect().width;
    const paneWidth = pane.clientWidth;
    const before = gutter.getBoundingClientRect().top - text.getBoundingClientRect().top;
    pane.scrollTop = 200;
    const after = gutter.getBoundingClientRect().top - text.getBoundingClientRect().top;
    const oldLeft = gutter.getBoundingClientRect().left;
    document.querySelector('.change-review-content').style.setProperty('--navigator-width', '500px');
    const newLeft = gutter.getBoundingClientRect().left;
    return { contentWidth, paneWidth, before, after, movement: newLeft - oldLeft };
  })()`,
    ),
  );
  assert.ok(
    result.contentWidth <= result.paneWidth,
    `long line must wrap: ${JSON.stringify(result)}`,
  );
  assert.ok(
    Math.abs(result.after - result.before) < 2,
    `gutter must scroll with its row: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.movement > 100,
    `gutter must follow navigator resize: ${JSON.stringify(result)}`,
  );

  browser(session, "find", "role", "button", "click", "--name", "Split");
  const split = JSON.parse(
    browser(
      session,
      "eval",
      `(() => {
    const rows = document.querySelectorAll('.d2h-diff-tbody tr');
    const row = Array.from(rows).find(item => item.cells.length === 4 && item.querySelector('.d2h-code-line-ctn'));
    if (!row) return { aligned: false };
    const text = row.cells[1].querySelector('.d2h-code-line-ctn');
    text.textContent = 'longword'.repeat(120);
    const next = row.nextElementSibling;
    const gutter = row.cells[0].getBoundingClientRect();
    const left = row.cells[1].getBoundingClientRect();
    const right = row.cells[3].getBoundingClientRect();
    return { aligned: true, gutterHeight: gutter.height, leftHeight: left.height, rightHeight: right.height, textWidth: text.getBoundingClientRect().width, cellWidth: left.width, nextTop: next?.getBoundingClientRect().top, rowBottom: row.getBoundingClientRect().bottom };
  })()`,
    ),
  );
  assert.ok(
    split.aligned,
    `split sides must share rows: ${JSON.stringify(split)}`,
  );
  assert.ok(
    split.textWidth <= split.cellWidth,
    `split text must wrap: ${JSON.stringify(split)}`,
  );
  assert.ok(
    Math.abs(split.leftHeight - split.rightHeight) < 2 &&
      Math.abs(split.gutterHeight - split.leftHeight) < 2,
    `split gutters and sides must match wrapped height: ${JSON.stringify(split)}`,
  );
  assert.ok(
    Math.abs(split.nextTop - split.rowBottom) < 2,
    `next split row must follow wrapped row: ${JSON.stringify(split)}`,
  );

  browser(session, "find", "role", "tab", "click", "--name", "Docs");
  browser(
    session,
    "wait",
    "--fn",
    "!!document.querySelector('.docs-markdown')",
  );
  const docs = JSON.parse(
    browser(
      session,
      "eval",
      `(() => {
    const article = document.querySelector('.docs-markdown');
    article.innerHTML = '<pre><code>' + 'longword'.repeat(200) + '</code></pre><table><thead><tr><th>One</th><th>Two</th><th>Three</th><th>Four</th><th>Five</th></tr></thead><tbody><tr><td>small</td><td>small</td><td>small</td><td>small</td><td>' + 'longword '.repeat(30) + '</td></tr></tbody></table>';
    const pre = article.querySelector('pre');
    return { widths: Array.from(article.querySelectorAll('th'), cell => cell.getBoundingClientRect().width), codeScroll: pre.scrollWidth, codeWidth: pre.clientWidth };
  })()`,
    ),
  );
  assert.ok(
    Math.max(...docs.widths) - Math.min(...docs.widths) < 2,
    `wide table columns should be equal: ${docs.widths}`,
  );
  assert.ok(
    docs.codeScroll <= docs.codeWidth + 1,
    `Markdown code should wrap: ${JSON.stringify(docs)}`,
  );
});
