import assert from "node:assert/strict";
import { test, afterAll } from "vitest";
import { render } from "solid-js/web";
import { createComponent, createEffect } from "solid-js";
import { Tooltip } from "../index.js";
const mount = (props = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => createComponent(Tooltip, { content: "Helpful details", ...props }),
    host,
  );
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
afterAll(async () => {
  await window.happyDOM.abort();
});

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
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
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
  const dispose = render(
    () =>
      createComponent(Tooltip, {
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
          createEffect(() =>
            button.setAttribute(
              "aria-describedby",
              tooltipProps["aria-describedby"],
            ),
          );
          return button;
        },
        ref: (element) => {
          triggerRef = element;
        },
      }),
    host,
  );
  const trigger = host.querySelector("button");
  assert.equal(trigger, triggerRef);
  assert.equal(trigger.getAttribute("aria-label"), "Reset");
  trigger.focus();
  await wait(280);
  const tooltip = document.querySelector('[role="tooltip"]');
  assert.equal(
    trigger.getAttribute("aria-describedby"),
    `reset-help ${tooltip.id}`,
  );
  trigger.click();
  assert.equal(activations, 1);
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
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
  window.requestAnimationFrame = (callback) => {
    frame = callback;
  };
  window.innerWidth = 300;
  window.innerHeight = 200;
  const mounted = mount();
  const trigger = mounted.host.querySelector("button");
  trigger.getBoundingClientRect = () => ({
    top: 4,
    bottom: 14,
    left: 280,
    right: 290,
    width: 10,
    height: 10,
  });
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
