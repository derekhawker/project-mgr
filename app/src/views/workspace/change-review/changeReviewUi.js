import { invokeCommand } from "../../../services/commandContract.js";

export function loadChangeReview(invoke, ownerType, ownerId, ticketFilename) {
  return invokeCommand(invoke, "change_review_load", {
    request: { ownerType, ownerId, ...(ticketFilename ? { ticketFilename } : {}) },
  });
}

export function loadFullDiff(invoke, ownerType, ownerId, repositoryId, path, ticketFilename) {
  return invokeCommand(invoke, "change_review_full_diff", {
    request: { ownerType, ownerId, repositoryId, path, ...(ticketFilename ? { ticketFilename } : {}) },
  });
}
