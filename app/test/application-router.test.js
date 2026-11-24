import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationRouter } from "../src/application/applicationRouter.js";

test("navigation atomically replaces destination context and invalidates old work", () => {
  const router = createApplicationRouter("no-selection");
  const first = router.navigate("quick-request", { requestId: "request-a" });
  assert.equal(router.location(), first);
  assert.equal(router.isCurrent(first), true);

  const second = router.navigate("workspace-ticket", {
    workspaceId: "workspace-a",
    filename: "ticket.md",
  });
  assert.deepEqual(router.location(), second);
  assert.equal(router.isCurrent(first), false);
  assert.equal(router.isCurrent(second.generation), true);
});

test("same-destination navigation advances generation for changed context", () => {
  const router = createApplicationRouter("workspace-ticket");
  const first = router.navigate("workspace-ticket", {
    workspaceId: "same-workspace",
    filename: "first.md",
  });
  const second = router.navigate("workspace-ticket", {
    workspaceId: "same-workspace",
    filename: "second.md",
  });

  assert.notEqual(first.generation, second.generation);
  assert.equal(router.isCurrent(first), false);
  assert.equal(router.location().context.filename, "second.md");
});
