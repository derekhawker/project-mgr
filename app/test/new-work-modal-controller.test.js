import test from "node:test";
import assert from "node:assert/strict";
import { createNewWorkModalController } from "../src/features/new-work/modal/newWorkModalController.js";

function setup(session = null, failClose = false) {
  const calls = [];
  const controller = createNewWorkModalController({
    getProposalSessionId: () => session,
    setWorkType: (v) => calls.push(["type", v]),
    setView: (v) => calls.push(["view", v]),
    setPrompt: (v) => calls.push(["prompt", v]),
    setCaptureError: (v) => calls.push(["error", v]),
    focusPrompt: () => calls.push(["focus"]),
    closeProposalSession: async () => {
      calls.push(["cleanup"]);
      if (failClose) throw Error();
    },
  });
  return { controller, calls };
}

test("open accepts work types and ignores invalid types", () => {
  const { controller, calls } = setup();
  controller.open("invalid");
  assert.deepEqual(calls, []);
  controller.open("quick_request");
  assert.deepEqual(calls, [
    ["type", "quick_request"],
    ["view", "capture"],
    ["prompt", ""],
    ["error", ""],
    ["focus"],
  ]);
});

test("cancel closes immediately and performs proposal cleanup independently", async () => {
  const ok = setup("proposal");
  await ok.controller.cancel();
  assert.deepEqual(ok.calls, [["view", "closed"], ["cleanup"]]);
  const failed = setup("proposal", true);
  await failed.controller.cancel();
  assert.deepEqual(failed.calls, [["view", "closed"], ["cleanup"]]);
});

test("back returns to capture and focuses prompt", () => {
  const { controller, calls } = setup();
  controller.backToCapture();
  assert.deepEqual(calls, [["view", "capture"], ["focus"]]);
});
