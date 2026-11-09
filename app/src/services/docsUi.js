import { invokeCommand } from "./commandContract.js";

export function loadDocs(invoke, ownerType, ownerId, ticketFilename) {
  return invokeCommand(invoke, "docs_list", {
    request: { ownerType, ownerId, ...(ticketFilename ? { ticketFilename } : {}) },
  });
}

export function readDoc(invoke, ownerType, ownerId, path, ticketFilename) {
  return invokeCommand(invoke, "docs_read", {
    request: {
      ownerType,
      ownerId,
      ...(ticketFilename ? { ticketFilename } : {}),
      path: path.path,
      repositoryId: path.repositoryId ?? null,
    },
  });
}
