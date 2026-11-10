import test from "node:test";
import assert from "node:assert/strict";
import {
  getUiDiagnostics,
  recordUiDiagnostic,
} from "../src/lib/uiDiagnostics.js";

test("UI diagnostics aggregate fixed labels without storing navigation data", () => {
  recordUiDiagnostic("WorkspaceNavigation", "workspace-pointer-enter");
  const diagnostics = getUiDiagnostics();
  assert.equal(diagnostics["WorkspaceNavigation:workspace-pointer-enter"], 1);

  for (let index = 0; index < 105; index += 1)
    recordUiDiagnostic("WorkspaceNavigation", "workspace-pointer-leave");
  const after = getUiDiagnostics();
  assert.equal(after["WorkspaceNavigation:workspace-pointer-leave"], 105);
  assert.equal(Object.hasOwn(after, "workspace"), false);
});
