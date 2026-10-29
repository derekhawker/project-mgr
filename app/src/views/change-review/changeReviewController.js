export function createChangeReviewController({
  invoke,
  loadChangeReview,
  getSelectedWorkspace,
  getSelectedOwnerRepositoryCount,
  getSelectedQuickRequest,
  getRepositoryToolsOwner,
  syncRepositoryToolsAvailability,
  docsController,
  setChangeReviewAvailable,
  setChangeReviewSelected,
  setChangeReviewDisabled,
  setChangeReviewVisible,
  setChangeReviewSummary,
  setChangeReviewError,
  setChangeReviewRepositories,
  setDocsButtonSelected,
  setSelectedOwnerVisible,
}) {
  function showOwnerTerminal() {
    setChangeReviewVisible(false);
    docsController.showTerminal();
    setSelectedOwnerVisible(true);
    setChangeReviewSelected(false);
  }

  function syncChangeReviewAvailability() {
    const available = Boolean(
      getSelectedWorkspace() &&
      getSelectedOwnerRepositoryCount() > 0 &&
      !getSelectedQuickRequest()?.quickRequest,
    );
    setChangeReviewAvailable(available);
    setDocsButtonSelected(false);
    if (!available) showOwnerTerminal();
    syncRepositoryToolsAvailability();
  }

  async function refreshDocsAvailability() {
    const workspace = getSelectedWorkspace();
    if (!workspace || getSelectedQuickRequest()?.quickRequest) return;
    await docsController.refresh({ type: "workspace", id: workspace.id });
  }

  async function handleChangeReviewClick(event) {
    const workspace = getSelectedWorkspace();
    if (!workspace || !getSelectedOwnerRepositoryCount()) return;
    const ownerType = "workspace";
    const ownerId = workspace.id;
    docsController.showTerminal();
    setChangeReviewDisabled(true);
    setChangeReviewSelected(true);
    setSelectedOwnerVisible(false);
    setChangeReviewVisible(true);
    setChangeReviewSummary("Loading changes…");
    setChangeReviewError("");
    setChangeReviewRepositories([]);
    try {
      const repositories = await loadChangeReview(invoke, ownerType, ownerId);
      if (getSelectedWorkspace()?.id !== ownerId) return;
      const totalFiles = repositories.reduce(
        (sum, repository) => sum + repository.files.length,
        0,
      );
      setChangeReviewSummary(
        `${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"} · ${totalFiles} ${totalFiles === 1 ? "file" : "files"} changed`,
      );
      setChangeReviewRepositories(repositories);
    } catch (error) {
      setChangeReviewSummary(`Could not load changes: ${String(error)}`);
      setChangeReviewError(`Could not load changes: ${String(error)}`);
    } finally {
      setChangeReviewDisabled(false);
    }
  }

  return {
    showOwnerTerminal,
    syncChangeReviewAvailability,
    refreshDocsAvailability,
    handleChangeReviewClick,
  };
}
