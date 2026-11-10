import test from "node:test";
import assert from "node:assert/strict";
import { newWorkProgressDestination } from "../src/features/new-work/modal/newWorkProgress.js";

test("progress follows the active New-work pane, not the retained proposal type", () => {
  // Back/reopen can retain a prior proposal. Capture must still own progress.
  // Selection during creation can close the view before recovery reopens review.
  for (const workType of ["workspace", "quick_request"]) {
    for (const [capture, review, expected] of [
      [false, false, null],
      [true, false, "capture"],
      [false, true, workType],
      [true, false, "capture"],
      [false, false, null],
      [false, true, workType],
    ]) {
      assert.equal(
        newWorkProgressDestination(capture, review, workType),
        expected,
      );
    }
  }
});
