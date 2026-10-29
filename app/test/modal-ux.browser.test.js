import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

test("New Work modal sizes to content and keeps standard dialog interactions", async (t) => {
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
  const session = `modal-ux-${process.pid}`;
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
      /* Starting Vite. */
    }
    assert.ok(Date.now() < deadline, "Vite starts within 15 seconds");
    await new Promise((done) => setTimeout(done, 100));
  }
  const open = (type) => {
    browser("click", "#new-work-menu summary");
    browser("click", `[data-new-work-type="${type}"]`);
    browser("wait", "--fn", "document.querySelector('#new-work-dialog').open");
    browser(
      "wait",
      "--fn",
      "document.querySelector('#new-work-dialog').getAnimations().every(a => a.playState === 'finished')",
    );
  };
  const geometry = () =>
    evaluate(`(() => {
    const d = document.querySelector('#new-work-dialog');
    const footer = [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Continue');
    const r = d.getBoundingClientRect(), f = footer.getBoundingClientRect();
    return { gap: r.bottom - f.bottom, top: r.top, bottom: r.bottom, height: r.height, viewport: innerHeight };
  })()`);
  browser("open", url);
  browser("set", "viewport", "1280", "900");
  open("workspace");
  await t.test("disclosure icon and label share a line", () => {
    const alignment = evaluate(`(() => {
      const summary = document.querySelector('#proposal-prompt-preview summary');
      const icon = summary.querySelector('svg').getBoundingClientRect();
      const text = [...summary.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(text);
      const label = range.getBoundingClientRect();
      return { iconTop: icon.top, iconBottom: icon.bottom, labelTop: label.top, labelBottom: label.bottom };
    })()`);
    assert.ok(alignment.iconTop < alignment.labelBottom && alignment.labelTop < alignment.iconBottom, JSON.stringify(alignment));
  });
  await t.test(
    "dialog text and primary actions meet accessibility checks at rest and on hover",
    () => {
      for (const hovered of [false, true]) {
        if (hovered) browser("hover", 'button[form="new-work-capture"]');
        const audit = JSON.parse(
          browser("a11y", "--selector", "#new-work-dialog", "--json"),
        );
        assert.equal(
          audit.data.counts.violations,
          0,
          JSON.stringify(audit.data.violations),
        );
      }
    },
  );
  await t.test("capture has no expanding blank area below its actions", () => {
    const g = geometry();
    assert.ok(g.gap < 32, `Blank area below actions: ${g.gap}px`);
    assert.ok(g.height < g.viewport, `Capture should fit its viewport: ${g.height}px`);
    assert.equal(evaluate("document.querySelector('#new-work-prompt').rows"), 9);
  });
  await t.test(
    "header close, Escape, focus containment and restoration",
    () => {
      assert.equal(evaluate("document.activeElement.id"), "new-work-prompt");
      assert.equal(
        evaluate(
          "!!document.querySelector('#new-work-dialog button[aria-label=\"Close dialog\"]')",
        ),
        true,
      );
      browser("mouse", "move", "4", "4");
      browser("mouse", "down");
      browser("mouse", "up");
      assert.equal(
        evaluate("document.querySelector('#new-work-dialog').open"),
        true,
        "Backdrop does not discard work",
      );
      browser("focus", "#new-work-prompt");
      browser("press", "Shift+Tab");
      browser("press", "Shift+Tab");
      assert.equal(
        evaluate(
          "document.querySelector('#new-work-dialog').contains(document.activeElement)",
        ),
        true,
      );
      browser("click", '#new-work-dialog button[aria-label="Close dialog"]');
      browser(
        "wait",
        "--fn",
        "!document.querySelector('#new-work-dialog').open && document.activeElement.matches('#new-work-menu summary')",
      );
      assert.equal(
        evaluate("document.activeElement.matches('#new-work-menu summary')"),
        true,
      );
      open("workspace");
      browser("press", "Escape");
      browser(
        "wait",
        "--fn",
        "!document.querySelector('#new-work-dialog').open",
      );
    },
  );
  // Recover independently after a failed interaction assertion.
  browser("press", "Escape");
  open("quick_request");
  assert.equal(evaluate("document.querySelector('#new-work-prompt').rows"), 9);
  await t.test(
    "footer submit preserves native validation and multiline input",
    () => {
      browser("find", "role", "button", "click", "--name", "Continue");
      assert.equal(
        evaluate("document.querySelector('#new-work-review').hidden"),
        true,
      );
      assert.equal(evaluate("document.activeElement.id"), "new-work-prompt");
      browser("fill", "#new-work-prompt", "First line");
      browser("press", "Shift+Enter");
      assert.equal(
        evaluate("document.querySelector('#new-work-prompt').value"),
        "First line\n",
      );
    },
  );
  browser("fill", "#new-work-prompt", "Review a small fixture change");
  browser("find", "role", "button", "click", "--name", "Continue");
  browser("wait", "--fn", "!document.querySelector('#new-work-review').hidden");
  await t.test(
    "review grows only to its content and focuses an active field",
    () => {
      const state = evaluate(`(() => {
      const d = document.querySelector('#new-work-dialog');
      return { height: d.getBoundingClientRect().height, focus: document.activeElement.id };
    })()`);
      assert.ok(
        state.height < 700,
        `Short review is needlessly tall: ${state.height}px`,
      );
      assert.equal(state.focus, "quick-request-directory");
    },
  );
  await t.test(
    "short viewport keeps review actions visible and body scrollable",
    () => {
      browser("set", "viewport", "390", "360");
      const state = evaluate(`(() => {
      const d = document.querySelector('#new-work-dialog');
      const body = d.querySelector('[data-modal-body]');
      const r = document.querySelector('#proposal-create').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, scrollable: !!body && body.scrollHeight > body.clientHeight, width: d.getBoundingClientRect().width };
    })()`);
      assert.ok(
        state.top >= 0 && state.bottom <= 360,
        "Review action stays visible",
      );
      assert.ok(state.width <= 390, "Dialog fits the viewport");
      assert.ok(
        state.scrollable,
        "Only the body scrolls when content overflows",
      );
      browser("click", "#proposal-back");
      const g = geometry();
      assert.ok(
        g.top >= 0 && g.bottom <= 360,
        "Capture also fits a short viewport",
      );
    },
  );
  await t.test(
    "long review content scrolls without moving the footer or growing beyond the window",
    () => {
      browser("set", "viewport", "1280", "900");
      browser(
        "fill",
        "#new-work-prompt",
        "Long fixture prompt with an unbroken path /" +
          "directory/".repeat(100) +
          "\nReview this change.\n".repeat(60),
      );
      browser("press", "Enter");
      browser(
        "wait",
        "--fn",
        "!document.querySelector('#new-work-review').hidden",
      );
      const state = evaluate(`(() => {
      const d = document.querySelector('#new-work-dialog'), body = d.querySelector('[data-modal-body]');
      const before = document.querySelector('#proposal-create').getBoundingClientRect().bottom;
      body.scrollTop = body.scrollHeight;
      return { height: d.getBoundingClientRect().height, scroll: body.scrollTop, before, after: document.querySelector('#proposal-create').getBoundingClientRect().bottom, overflow: body.scrollWidth - body.clientWidth };
    })()`);
      assert.ok(state.height <= 868, "Review is bounded by the viewport");
      assert.ok(state.scroll > 0, "Long content can be read by scrolling");
      assert.equal(state.before, state.after, "Actions do not scroll away");
      assert.ok(
        state.overflow <= 1,
        "Long paths wrap rather than widening the dialog",
      );
    },
  );
});
