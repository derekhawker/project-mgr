import test from "node:test";
import { execFileSync } from "node:child_process";

test("persistent Quick Request observers follow owner selection without record refreshes", () => {
  // Node normally resolves Solid's nonreactive server build. Use its production
  // client condition in an isolated process: signals/computations only, no DOM.
  execFileSync(
    process.execPath,
    [
      "--conditions=browser",
      "--input-type=module",
      "--eval",
      `await (${checkSelection.toString()})();`,
    ],
    {
      cwd: new URL("../", import.meta.url),
      timeout: 10_000,
    },
  );
});

async function checkSelection() {
  const assert = (await import("node:assert/strict")).default;
  const { createRoot, createComputed } = await import("solid-js");
  const { createQuickRequestSelection } =
    await import("./src/views/quick-requests/quickRequestSelection.js");
  const selection = createQuickRequestSelection();
  const records = [{ task: { id: "qr-1" } }, { task: { id: "qr-2" } }];
  const observations = [];
  const dispose = createRoot((dispose) => {
    // Subscribe once per unchanged record, like reused For rows. Reading an
    // accessor after a write alone would miss the original invalidation gap.
    records.forEach(({ task }) => {
      createComputed(() =>
        observations.push([task.id, selection.selectedId() === task.id]),
      );
    });
    return dispose;
  });
  try {
    assert.equal(selection.selectedQuickRequest(), null);
    assert.equal(selection.selectedId(), undefined);
    assert.deepEqual(observations.splice(0), [
      ["qr-1", false],
      ["qr-2", false],
    ]);
    const expectSelection = (task, expected) => {
      selection.setSelectedQuickRequest(task);
      assert.equal(selection.selectedQuickRequest(), task);
      assert.deepEqual(observations.splice(0), expected);
    };
    expectSelection(records[0].task, [
      ["qr-1", true],
      ["qr-2", false],
    ]);
    expectSelection(records[1].task, [
      ["qr-1", false],
      ["qr-2", true],
    ]);
    expectSelection(null, [
      ["qr-1", false],
      ["qr-2", false],
    ]); // Workspace selection
    expectSelection(records[0].task, [
      ["qr-1", true],
      ["qr-2", false],
    ]);
    expectSelection(null, [
      ["qr-1", false],
      ["qr-2", false],
    ]); // Selected deletion/clear
  } finally {
    dispose();
  }
}
