import { invokeCommand } from './command-contract.js';

export function loadDocs(invoke, ownerType, ownerId) {
  return invokeCommand(invoke, 'docs_list', { request: { ownerType, ownerId } });
}

export function readDoc(invoke, ownerType, ownerId, path) {
  return invokeCommand(invoke, 'docs_read', {
    request: { ownerType, ownerId, path: path.path, repositoryId: path.repositoryId ?? null },
  });
}
