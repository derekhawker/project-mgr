import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { resolve } from "node:path";
import test from "node:test";

const appRoot = resolve(import.meta.dirname, "..");
const vite = resolve(appRoot, "node_modules/vite/bin/vite.js");

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

function browser(...args) {
  const result = spawnSync("agent-browser", args, {
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.stdout || `agent-browser exited ${result.status}`,
    );
  return result.stdout.trim();
}

test("icon buttons keep their SVG glyph at its intended 16px size in the rendered Quick Requests page", async (t) => {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}/`;
  const session = `icon-size-${process.pid}`;
  const server = spawn(
    process.execPath,
    [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: appRoot,
      stdio: "ignore",
    },
  );
  let browserStarted = false;
  t.after(async () => {
    if (browserStarted) {
      try {
        browser("--session", session, "close");
      } catch {
        /* Browser may have exited after a failed assertion. */
      }
    }
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      /* Vite is still starting. */
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  assert.ok(
    Date.now() < deadline,
    "Vite dev server should start within 15 seconds",
  );

  browser("--session", session, "open", url);
  browserStarted = true;
  browser(
    "--session",
    session,
    "click",
    'button[aria-label="See all Quick Requests"]',
  );
  browser(
    "--session",
    session,
    "wait",
    "--fn",
    "!!document.querySelector('#quick-request-full-list li button svg')",
  );
  const dimensions = JSON.parse(
    browser(
      "--session",
      session,
      "eval",
      "(()=>{const svg=document.querySelector('#quick-request-full-list li button svg');return {width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height}})()",
    ),
  );
  assert.ok(
    dimensions.width >= 16,
    `icon glyph should render at 16px wide; got ${dimensions.width}px`,
  );
  assert.ok(
    dimensions.height >= 16,
    `icon glyph should render at 16px high; got ${dimensions.height}px`,
  );

  await t.test(
    "navigation SVGs retain their size and replace the native disclosure marker",
    () => {
      const navigation = JSON.parse(
        browser(
          "--session",
          session,
          "eval",
          `(() => {
        const summary = document.querySelector('#new-work-menu summary');
        const size = selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return [rect.width, rect.height];
        };
        return {
          directories: size('#show-directories svg'),
          newWork: size('#new-work-menu summary svg'),
          marker: getComputedStyle(summary, '::marker').content,
          listStyle: getComputedStyle(summary).listStyleType,
          closedIndicator: getComputedStyle(summary.querySelector('svg')).transform,
        };
      })()`,
        ),
      );
      assert.deepEqual(navigation.directories, [16, 16]);
      assert.deepEqual(navigation.newWork, [16, 16]);
      assert.equal(navigation.marker, '""');
      assert.equal(navigation.listStyle, "none");
      browser("--session", session, "click", "#new-work-menu summary");
      const openIndicator = JSON.parse(
        browser(
          "--session",
          session,
          "eval",
          `(async () => {
            const icon = document.querySelector('#new-work-menu summary svg');
            getComputedStyle(icon).transform;
            await Promise.all(icon.getAnimations().map(animation => animation.finished));
            return getComputedStyle(icon).transform;
          })()`,
        ),
      );
      assert.notEqual(openIndicator, navigation.closedIndicator);
      browser("--session", session, "click", "#new-work-menu summary");
    },
  );

});
