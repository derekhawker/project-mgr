import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { build } from "vite";
import solid from "vite-plugin-solid";

const root = resolve(import.meta.dirname, "..");
const appRoot = resolve(root, "../..");
const temp = await mkdtemp("/tmp/opencode/ui-lib-tooltip-");
const entry = join(temp, "entry.js");
await writeFile(entry, `
export { render } from ${JSON.stringify(resolve(appRoot, "node_modules/solid-js/web/dist/web.js"))};
export { createComponent, createEffect } from ${JSON.stringify(resolve(appRoot, "node_modules/solid-js/dist/solid.js"))};
export { Tooltip } from ${JSON.stringify(join(root, "index.js"))};
`);
try {
  await build({
    configFile: false, root, plugins: [solid()], logLevel: "silent",
    build: { outDir: join(temp, "out"), lib: { entry, formats: ["es"], fileName: "tooltip" }, rollupOptions: { output: { inlineDynamicImports: true } } },
  });
} catch (error) {
  await rm(temp, { recursive: true, force: true });
  throw error;
}
const window = new Window();
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "HTMLHeadElement", "Event", "KeyboardEvent"])
  globalThis[key] = key === "window" ? window : key === "document" ? window.document : window[key];
const { render, createComponent, createEffect, Tooltip } = await import(pathToFileURL(join(temp, "out/tooltip.js")));
const mount = (props = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => createComponent(Tooltip, { content: "Helpful details", ...props }), host);
  return { host, dispose: () => { dispose(); host.remove(); } };
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
test.after(async () => { await window.happyDOM.abort(); await rm(temp, { recursive: true, force: true }); });

test("shows after 250ms on focus and exposes the tooltip relationship; Escape dismisses", async () => {
  const mounted = mount();
  const trigger = mounted.host.querySelector("button");
  assert.equal(trigger.getAttribute("aria-label"), "More information");
  trigger.focus();
  await wait(100);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  await wait(200);
  const tooltip = document.querySelector('[role="tooltip"]');
  assert.equal(tooltip.textContent, "Helpful details");
  assert.equal(trigger.getAttribute("aria-describedby"), tooltip.id);
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  mounted.dispose();
});

test("hover dismissal cancels pending show and unmount cleans up", async () => {
  const mounted = mount();
  const trigger = mounted.host.querySelector("button");
  trigger.dispatchEvent(new Event("mouseenter"));
  await wait(280);
  assert.ok(document.querySelector('[role="tooltip"]'));
  trigger.dispatchEvent(new Event("mouseleave"));
  await wait(280);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  trigger.dispatchEvent(new Event("mouseenter"));
  mounted.dispose();
  await wait(280);
});

test("supports a shared custom delay for both hover opening and closing", async () => {
  const mounted = mount({ delay: 150 });
  const trigger = mounted.host.querySelector("button");
  trigger.dispatchEvent(new Event("mouseenter"));
  await wait(100);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  await wait(80);
  assert.ok(document.querySelector('[role="tooltip"]'));
  trigger.dispatchEvent(new Event("mouseleave"));
  await wait(100);
  assert.ok(document.querySelector('[role="tooltip"]'));
  await wait(80);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  mounted.dispose();
});

test("renderTrigger attaches hover, focus, Escape, ref, and description to the action itself", async () => {
  let triggerRef;
  let activations = 0;
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => createComponent(Tooltip, {
    content: "Reset clears the workspace",
    "aria-describedby": "reset-help",
    renderTrigger: (tooltipProps) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", "Reset");
      button.setAttribute("aria-describedby", "reset-help");
      button.textContent = "Reset";
      button.addEventListener("mouseenter", tooltipProps.onMouseEnter);
      button.addEventListener("mouseleave", tooltipProps.onMouseLeave);
      button.addEventListener("focus", tooltipProps.onFocus);
      button.addEventListener("blur", tooltipProps.onBlur);
      button.addEventListener("keydown", tooltipProps.onKeyDown);
      button.addEventListener("click", () => activations++);
      tooltipProps.ref(button);
      createEffect(() => button.setAttribute("aria-describedby", tooltipProps["aria-describedby"]));
      return button;
    },
    ref: (element) => { triggerRef = element; },
  }), host);
  const trigger = host.querySelector("button");
  assert.equal(trigger, triggerRef);
  assert.equal(trigger.getAttribute("aria-label"), "Reset");
  trigger.focus();
  await wait(280);
  const tooltip = document.querySelector('[role="tooltip"]');
  assert.equal(trigger.getAttribute("aria-describedby"), `reset-help ${tooltip.id}`);
  trigger.click();
  assert.equal(activations, 1);
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  assert.equal(trigger.getAttribute("aria-describedby"), "reset-help");
  trigger.dispatchEvent(new Event("blur"));
  trigger.dispatchEvent(new Event("mouseenter"));
  await wait(280);
  assert.ok(document.querySelector('[role="tooltip"]'));
  trigger.dispatchEvent(new Event("mouseleave"));
  await wait(280);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  dispose();
  host.remove();
});

test("keeps the first tooltip frame hidden until viewport-edge placement is measured", async () => {
  const oldFrame = window.requestAnimationFrame;
  const oldWidth = window.innerWidth;
  const oldHeight = window.innerHeight;
  let frame;
  window.requestAnimationFrame = (callback) => { frame = callback; };
  window.innerWidth = 300;
  window.innerHeight = 200;
  const mounted = mount();
  const trigger = mounted.host.querySelector("button");
  trigger.getBoundingClientRect = () => ({ top: 4, bottom: 14, left: 280, right: 290, width: 10, height: 10 });
  trigger.dispatchEvent(new Event("mouseenter"));
  await wait(270);
  const tooltip = document.querySelector('[role="tooltip"]');
  assert.ok(tooltip);
  tooltip.getBoundingClientRect = () => ({ width: 120, height: 50 });
  assert.equal(tooltip.style.visibility, "hidden");
  assert.equal(tooltip.style.left, "0px");
  frame();
  assert.equal(tooltip.style.visibility, "visible");
  assert.equal(tooltip.style.left, "172px");
  assert.equal(tooltip.style.top, "22px");
  mounted.dispose();
  window.requestAnimationFrame = oldFrame;
  window.innerWidth = oldWidth;
  window.innerHeight = oldHeight;
});
