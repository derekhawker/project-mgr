import assert from "node:assert/strict";
import { test } from "vitest";
import { render } from "solid-js/web";
import { createSignal, createComponent } from "solid-js";
import { Modal, Drawer } from "@ui-lib";

const mount = (Component, props) => {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(() => createComponent(Component, props), host);
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
};

for (const [name, Component, expectedCloseName] of [
  ["Modal", Modal, "Close dialog"],
  ["Drawer", Drawer, "Close drawer"],
]) {
  test(`${name}: backdrop is inert, Escape and visible close request controlled closure`, () => {
    const [open, setOpen] = createSignal(true);
    let requests = 0;
    const mounted = mount(Component, {
      get open() {
        return open();
      },
      title: "Details",
      onCloseRequest: () => requests++,
      children: "Content",
    });
    const dialog = mounted.host.querySelector("dialog");
    assert.equal(dialog.open, true);
    assert.equal(dialog.getAttribute("aria-labelledby")?.length > 0, true);

    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    assert.equal(requests, 0, "backdrop click does not dismiss");

    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(requests, 1);
    assert.equal(dialog.open, true, "controlled owner can veto closure");

    const close = mounted.host.querySelector("button");
    assert.equal(close.getAttribute("aria-label"), expectedCloseName);
    close.click();
    assert.equal(requests, 2);
    assert.equal(dialog.open, true);
    setOpen(false);
    assert.equal(dialog.open, false);
    mounted.dispose();
  });
}

test("unnamed dialogs warn in development; labelled components do not", () => {
  const warnings = [];
  const previous = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    for (const Component of [Modal, Drawer]) {
      const missing = mount(Component, { open: false, tabs: [] });
      missing.dispose();
      const named = mount(Component, {
        open: false,
        "aria-labelledby": "heading",
      });
      named.dispose();
    }
    assert.deepEqual(warnings, [
      "Modal requires a title, aria-label, or aria-labelledby.",
      "Drawer requires a title, aria-label, or aria-labelledby.",
    ]);
  } finally {
    console.warn = previous;
  }
});
