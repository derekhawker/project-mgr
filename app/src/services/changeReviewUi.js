import { invokeCommand } from "./commandContract.js";

export function loadChangeReview(invoke, ownerType, ownerId) {
  return invokeCommand(invoke, "change_review_load", {
    request: { ownerType, ownerId },
  });
}

export function loadFullDiff(invoke, ownerType, ownerId, repositoryId, path) {
  return invokeCommand(invoke, "change_review_full_diff", {
    request: { ownerType, ownerId, repositoryId, path },
  });
}
