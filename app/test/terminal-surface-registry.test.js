import assert from "node:assert/strict";
import test from "node:test";
import { createTerminalSurfaceRegistry } from "../src/terminal/terminalSurfaceRegistry.js";

function surface() {
  return {
    hidden: false,
    removed: false,
    remove() {
      this.removed = true;
    },
  };
}

test("registration, selection, and hiding only toggle the active terminal surfaces", () => {
  const registry = createTerminalSurfaceRegistry();
  const first = surface();
  const second = surface();
  registry.register("first", first);
  registry.register("second", second);

  assert.equal(first.hidden, true);
  assert.equal(second.hidden, true);
  assert.equal(registry.show("first"), true);
  assert.equal(first.hidden, false);
  assert.equal(registry.show("second"), true);
  assert.equal(first.hidden, true);
  assert.equal(second.hidden, false);
  registry.hide();
  assert.equal(second.hidden, true);
});

test("removing a terminal releases its node and permits cleanup when already missing", () => {
  const registry = createTerminalSurfaceRegistry();
  const terminal = surface();
  registry.register("session", terminal);
  registry.show("session");
  registry.remove("session");

  assert.equal(terminal.removed, true);
  assert.equal(registry.get("session"), null);
  assert.equal(registry.show("session"), false);
  assert.doesNotThrow(() => registry.remove("session"));
});
