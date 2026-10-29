export function createWorkspaceNavigationController({
  getSelectedWorkspace,
  getSelectedQuickRequest,
  getRepositoryCatalog,
  getNavigationData,
  setNavigationData,
  setWorkspaceNavigation,
  setWorkspaceSelected,
  setAttachedRepositoryRows,
  setNavigationBusy,
  getSelectedOwnerRepositoryCount,
  setSelectedOwnerRepositoryCount,
  syncChangeReviewAvailability,
}) {
  function renderAttachedRepositories(workspaceId, data = getNavigationData()) {
    const bindings = (data.workspaceRepositories || []).filter(
      (binding) => binding.workspaceId === workspaceId,
    );
    const repositories = new Map(
      (getRepositoryCatalog() || []).map((repository) => [
        repository.id,
        repository,
      ]),
    );
    setAttachedRepositoryRows(
      bindings.map((binding) => ({
        label: `${repositories.get(binding.repositoryId)?.name || binding.repositoryId} · ${binding.branch} · ${binding.verificationStatus}`,
        checkoutPath: binding.checkoutPath,
      })),
    );
  }

  function renderNavigation(data) {
    setNavigationData(data);
    const selectedWorkspace = getSelectedWorkspace();
    const selectedQuickRequest = getSelectedQuickRequest();
    setWorkspaceNavigation({ data, selected: selectedWorkspace });
    if (selectedWorkspace && !selectedQuickRequest) {
      setSelectedOwnerRepositoryCount(
        (data.workspaceRepositories || []).filter(
          (binding) =>
            binding.workspaceId === selectedWorkspace.id &&
            binding.verificationStatus === "verified",
        ).length,
      );
      syncChangeReviewAvailability();
    }
    setWorkspaceSelected(Boolean(selectedWorkspace && !selectedQuickRequest));
    setNavigationBusy(false);
    if (selectedWorkspace)
      renderAttachedRepositories(selectedWorkspace.id, data);
  }

  return { renderNavigation, renderAttachedRepositories };
}
