export function prepareProposalReview(proposal, originalPrompt, { repositoryCatalog }) {
  if (proposal.workType !== "quick_request") {
    throw new Error("Only Quick Request proposals can be reviewed.");
  }
  const catalog = repositoryCatalog || [];
  const proposedId = proposal.repositories?.[0]?.repositoryId;
  return {
    workType: "quick_request",
    title: "New Quick Request — Confirm directory",
    originalPrompt,
    createLabel: "Confirm directory and start Quick Request",
    quickRequestDirectories: catalog,
    quickRequestDirectoryId: catalog.some((repository) => repository.id === proposedId)
      ? proposedId
      : "",
  };
}
