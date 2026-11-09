export function createWorkspaceNavigationController({
  getSelectedWorkspace,
  getSelectedQuickRequest,
  getNavigationData,
  setNavigationData,
  setWorkspaceNavigation,
  setWorkspaceSelected,
  setNavigationBusy,
  getSelectedOwnerRepositoryCount,
  setSelectedOwnerRepositoryCount,
  syncChangeReviewAvailability,
}) {
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
  }

  return { renderNavigation };
}
