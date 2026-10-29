import { invokeCommand } from "./commandContract.js";

export function loadPresentationPreferences(invoke) {
  return invokeCommand(invoke, "presentation_preferences_get");
}

export function saveFileNavigatorWidth(invoke, width) {
  return invokeCommand(invoke, "presentation_preferences_set_navigator_width", {
    request: { width },
  });
}

export function saveChangeReviewMode(invoke, mode) {
  return invokeCommand(
    invoke,
    "presentation_preferences_set_change_review_mode",
    { request: { mode } },
  );
}
