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
  setChangeReviewLoading,
  setDocsButtonSelected,
  setSelectedOwnerVisible,
}) {
  let generation = 0;
  function cancelPendingReview() {
    generation++;
    setChangeReviewLoading(false);
    setChangeReviewDisabled(false);
  }
  function showOwnerTerminal() {
    cancelPendingReview();
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
    const request = ++generation;
    docsController.showTerminal();
    setChangeReviewDisabled(true);
    setChangeReviewSelected(true);
    setSelectedOwnerVisible(false);
    setChangeReviewVisible(true);
    setChangeReviewSummary("Loading changes…");
    setChangeReviewError("");
    setChangeReviewRepositories([]);
    setChangeReviewLoading(true);
    try {
      const repositories = await loadChangeReview(invoke, ownerType, ownerId);
      if (request !== generation || getSelectedWorkspace()?.id !== ownerId)
        return;
      const totalFiles = repositories.reduce(
        (sum, repository) => sum + repository.files.length,
        0,
      );
      setChangeReviewSummary(
        `${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"} · ${totalFiles} ${totalFiles === 1 ? "file" : "files"} changed`,
      );
      setChangeReviewRepositories(repositories);
    } catch (error) {
      if (request !== generation || getSelectedWorkspace()?.id !== ownerId)
        return;
      setChangeReviewSummary(`Could not load changes: ${String(error)}`);
      setChangeReviewError(`Could not load changes: ${String(error)}`);
    } finally {
      if (request === generation) {
        setChangeReviewLoading(false);
        setChangeReviewDisabled(false);
      }
    }
  }

  return {
    showOwnerTerminal,
    cancelPendingReview,
    syncChangeReviewAvailability,
    refreshDocsAvailability,
    handleChangeReviewClick,
  };
}
