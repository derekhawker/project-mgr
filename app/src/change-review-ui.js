import { invokeCommand } from './command-contract.js';

export function loadChangeReview(invoke, ownerType, ownerId) {
  return invokeCommand(invoke, 'change_review_load', { request: { ownerType, ownerId } });
}
