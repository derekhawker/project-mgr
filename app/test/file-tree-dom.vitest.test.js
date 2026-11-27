import assert from "node:assert/strict";
import { test } from "vitest";
import { render } from "solid-js/web";
import { createComponent, createSignal } from "solid-js";
import { FileTree } from "../src/components/file-navigation/FileTree.jsx";

test("nested folders start expanded, can collapse, and retain file identity on selection", () => {
  const files = [
    { path: "README.md" },
    { path: "guides/api/README.md" },
    { path: "guides/intro.md" },
  ];
  const [selected, setSelected] = createSignal(files[0]);
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () =>
      createComponent(FileTree, {
        files,
        onSelect: setSelected,
        isSelected: (file) => selected() === file,
      }),
    host,
  );
  const folders = host.querySelectorAll("details");
  assert.equal(folders.length, 2);
  assert.ok([...folders].every((folder) => folder.open));
  assert.equal(folders[0].querySelector("summary span").textContent, "guides");
  assert.equal(folders[1].querySelector("summary span").textContent, "api");
  assert.equal(
    host.querySelectorAll('summary svg[aria-hidden="true"]').length,
    6,
  );
  for (const folder of folders) {
    const paths = folder
      .querySelector(":scope > summary")
      .querySelectorAll("svg path");
    assert.equal(paths.length, 3);
    assert.notEqual(paths[1].getAttribute("d"), paths[2].getAttribute("d"));
  }
  folders[0].open = false;
  folders[0].dispatchEvent(new Event("toggle"));
  assert.equal(folders[0].open, false);
  assert.equal(
    host.querySelector('[aria-label="2 hidden leaf nodes"]').textContent,
    "2",
  );
  folders[0].open = true;
  folders[0].dispatchEvent(new Event("toggle"));
  assert.equal(host.querySelector('[aria-label="2 hidden leaf nodes"]'), null);
  const nested = [...host.querySelectorAll("button")].find(
    (button) => button.title === "guides/api/README.md",
  );
  nested.click();
  assert.equal(selected(), files[1]);
  assert.equal(nested.getAttribute("aria-current"), "true");
  assert.equal(
    host
      .querySelector('button[title="README.md"]')
      .hasAttribute("aria-current"),
    false,
  );
  dispose();
  host.remove();
});
