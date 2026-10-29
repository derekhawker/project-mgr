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

test("shared controls keep consistent typography and whole-pixel spacing", async (t) => {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}/test/fixtures/ui-control-parity.html`;
  const session = `ui-control-fonts-${process.pid}`;
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
  browser("--session", session, "click", "#action-trigger");
  browser(
    "--session",
    session,
    "wait",
    "--fn",
    "!!document.querySelector('#action-content button')",
  );
  const fonts = JSON.parse(
    browser(
      "--session",
      session,
      "eval",
      `(()=>{
    const font = (selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight };
    };
    return {
      button: font('#standalone-control'),
      actionTrigger: font('#action-trigger'),
      actionItem: font('#action-item'),
      newWorkTrigger: font('#new-work-menu summary'),
      newWorkItem: font('#new-work-menu button'),
    };
  })()`,
    ),
  );

  for (const [control, font] of Object.entries(fonts).slice(1)) {
    assert.deepEqual(
      font,
      fonts.button,
      `${control} should use the shared Button typography`,
    );
  }

  await t.test("menu direction owns placement and chevron animation", () => {
    const results = JSON.parse(
      browser(
        "--session",
        session,
        "eval",
        `
      (async () => {
        const results = [];
        for (const [selector, up] of [
          ['#action-trigger', false],
          ['#upward-trigger', true],
          ['#new-work-menu summary', true],
        ]) {
          const trigger = document.querySelector(selector);
          const menu = trigger.closest('details');
          const icon = trigger.querySelector('svg');
          const surface = menu.querySelector('[role=group]');
          const orientation = () => new DOMMatrix(getComputedStyle(icon).transform).a;
          const toggle = async () => {
            trigger.click();
            getComputedStyle(icon).transform;
            const transitions = icon.getAnimations();
            const animated = transitions.some(animation => animation.transitionProperty === 'transform');
            await Promise.all(transitions.map(animation => animation.finished));
            await Promise.all(surface.getAnimations().map(animation => animation.finished));
            return animated;
          };
          menu.open = false;
          await Promise.all(icon.getAnimations().map(animation => animation.finished));
          const closed = orientation();
          const opening = await toggle();
          const opened = orientation();
          const bounds = surface.getBoundingClientRect();
          const anchor = trigger.getBoundingClientRect();
          const placed = up ? bounds.bottom <= anchor.top : bounds.top >= anchor.bottom;
          const closing = await toggle();
          results.push({selector, up, closed, opened, opening, closing, placed, closedAgain: orientation()});
        }
        return results;
      })()
    `,
      ),
    );
    for (const result of results) {
      assert.ok(
        Math.abs(result.closed - (result.up ? -1 : 1)) < 0.001,
        `${result.selector}: closed chevron points toward menu direction`,
      );
      assert.ok(
        Math.abs(result.opened - (result.up ? 1 : -1)) < 0.001,
        `${result.selector}: open chevron reverses`,
      );
      assert.ok(result.placed, `${result.selector}: popup follows direction`);
      assert.ok(result.opening, `${result.selector}: opening rotates smoothly`);
      assert.ok(result.closing, `${result.selector}: closing rotates smoothly`);
      assert.ok(Math.abs(result.closedAgain - result.closed) < 0.001);
    }
  });

  await t.test(
    "padding uses shared whole CSS pixels at different root font sizes",
    () => {
      for (const rootSize of [16, 20]) {
        const padding = JSON.parse(
          browser(
            "--session",
            session,
            "eval",
            `(() => {
            document.documentElement.style.fontSize = '${rootSize}px';
            return Object.fromEntries([
              '#standalone-control', '#action-trigger', '#action-item',
              '#new-work-menu summary', '#spacing-field', '#app-notice',
            ].map(selector => {
              const style = getComputedStyle(document.querySelector(selector));
              return [selector, [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]];
            }));
          })()`,
          ),
        );
        for (const selector of [
          "#standalone-control",
          "#action-trigger",
          "#action-item",
          "#new-work-menu summary",
        ]) {
          assert.deepEqual(
            padding[selector],
            ["6px", "12px", "6px", "12px"],
            `${selector} at ${rootSize}px root`,
          );
        }
        assert.deepEqual(padding["#spacing-field"], [
          "6px",
          "8px",
          "6px",
          "8px",
        ]);
        assert.deepEqual(padding["#app-notice"], [
          "10px",
          "12px",
          "10px",
          "12px",
        ]);
      }
    },
  );

  await t.test("Tools stacks Open in above scripts with a divider", () => {
    browser("--session", session, "click", "#show-repo-tools");
    for (const width of [1280, 720]) {
      browser("--session", session, "set", "viewport", String(width), "720");
      const layout = JSON.parse(
        browser(
          "--session",
          session,
          "eval",
          `(async () => {
            const menu = document.querySelector('#repo-tools-menu');
            await Promise.all(menu.getAnimations().map(animation => animation.finished));
            const sections = [...menu.querySelectorAll('h2')].map(heading => heading.parentElement);
            const [handoff, ...repositories] = sections;
            const bounds = element => {
              const {top, bottom, left, right} = element.getBoundingClientRect();
              return {top, bottom, left, right};
            };
            return {
              headings: sections.map(section => section.querySelector('h2').textContent),
              menu: bounds(menu),
              handoff: bounds(handoff),
              handoffButtons: [...handoff.querySelectorAll('button')].map(bounds),
              repositories: repositories.map(bounds),
              divider: bounds(menu.querySelector('hr')),
            };
          })()`,
        ),
      );
      assert.deepEqual(layout.headings, ["Open in…", "Frontend", "Backend"]);
      assert.ok(layout.menu.left >= 0 && layout.menu.right <= width);
      if (width === 1280) {
        assert.ok(
          layout.menu.right - layout.menu.left < 600,
          "short menu content must not stretch to fill the work area",
        );
      }
      assert.equal(layout.handoffButtons.length, 3);
      for (let index = 1; index < layout.handoffButtons.length; index++) {
        const previous = layout.handoffButtons[index - 1];
        const current = layout.handoffButtons[index];
        assert.ok(
          current.top >= previous.bottom,
          `Open in buttons stack vertically at ${width}px`,
        );
        assert.equal(current.left, previous.left);
        assert.equal(current.right, previous.right);
      }
      for (const repository of layout.repositories) {
        assert.ok(
          repository.top >= layout.handoff.bottom,
          `Open in appears above every repository at ${width}px`,
        );
      }
      assert.ok(layout.divider.top >= layout.handoff.bottom);
      assert.ok(layout.divider.right > layout.divider.left);
      for (const repository of layout.repositories) {
        assert.ok(repository.top >= layout.divider.bottom);
      }
      if (width === 1280) {
        const [first, second] = layout.repositories;
        assert.equal(
          first.top,
          second.top,
          "repository groups remain side by side",
        );
        assert.ok(second.left >= first.right);
      }
    }
    browser("--session", session, "click", "#show-repo-tools");
  });

  await t.test("reduced motion changes menu state without animation", () => {
    browser("--session", session, "set", "media", "reduced-motion");
    const result = JSON.parse(
      browser(
        "--session",
        session,
        "eval",
        `
      (() => {
        const trigger = document.querySelector('#upward-trigger');
        const menu = trigger.closest('details');
        trigger.click();
        const icon = trigger.querySelector('svg');
        const orientation = new DOMMatrix(getComputedStyle(icon).transform).a;
        return {
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          open: menu.open,
          orientation,
          animations: menu.getAnimations({subtree: true}).length,
        };
      })()
    `,
      ),
    );
    assert.equal(result.reduced, true);
    assert.equal(result.open, true);
    assert.ok(Math.abs(result.orientation - 1) < 0.001);
    assert.equal(result.animations, 0);
  });
});
