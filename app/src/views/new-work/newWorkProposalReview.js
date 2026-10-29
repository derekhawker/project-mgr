import {
  workspaceReviewDetails,
  workspaceStartingPrompt,
} from "../../services/shell.js";

export function prepareProposalReview(
  proposal,
  originalPrompt,
  { repositoryCatalog, repositoryLocations },
) {
  if (!["workspace", "quick_request"].includes(proposal.workType)) {
    throw new Error(
      "Only Workspace and Quick Request proposals can be created.",
    );
  }

  const isQuickRequest = proposal.workType === "quick_request";
  const details = isQuickRequest ? null : workspaceReviewDetails(proposal);
  const startingPrompt = workspaceStartingPrompt(proposal);
  const catalog = isQuickRequest ? repositoryCatalog || [] : null;
  const proposedId = isQuickRequest
    ? proposal.repositories[0]?.repositoryId
    : null;

  return {
    workType: proposal.workType,
    title: isQuickRequest
      ? "New Quick Request — Confirm directory"
      : "Review New Workspace",
    workspaceName: details?.name || "",
    workspaceDirectory: details?.directory || "",
    originalPrompt,
    startingPrompt,
    createLabel: isQuickRequest
      ? "Confirm directory and start Quick Request"
      : "Create Workspace",
    repositoryLocations: repositoryLocations(
      proposal.repositories,
      repositoryCatalog,
    ),
    quickRequestDirectories: catalog,
    quickRequestDirectoryId:
      isQuickRequest &&
      catalog.some((repository) => repository.id === proposedId)
        ? proposedId
        : "",
  };
}
