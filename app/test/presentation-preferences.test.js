import assert from "node:assert/strict";
import test from "node:test";
import { invokeCommand } from "../src/services/commandContract.js";
import {
  loadPresentationPreferences,
  saveFileNavigatorWidth,
  saveChangeReviewMode,
} from "../src/services/presentationPreferences.js";

test("preference adapters use the checked command contract", async () => {
  const calls = [];
  const value = {
    shared: { fileNavigator: { width: 320 } },
    changeReview: { mode: "split" },
  };
  const invoke = (name, payload) =>
    invokeCommand(
      async (command, request) => {
        calls.push([command, request]);
        return value;
      },
      name,
      payload,
    );
  assert.deepEqual(await loadPresentationPreferences(invoke), value);
  assert.deepEqual(await saveFileNavigatorWidth(invoke, 320), value);
  assert.deepEqual(await saveChangeReviewMode(invoke, "split"), value);
  assert.deepEqual(calls, [
    ["presentation_preferences_get", undefined],
    [
      "presentation_preferences_set_navigator_width",
      { request: { width: 320 } },
    ],
    [
      "presentation_preferences_set_change_review_mode",
      { request: { mode: "split" } },
    ],
  ]);
  await assert.rejects(
    () =>
      invokeCommand(
        async () => ({ shared: {} }),
        "presentation_preferences_get",
      ),
    /changeReview/,
  );
});
