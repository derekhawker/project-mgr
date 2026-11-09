export function createWorkspaceCreationController(deps) {
  const {
    getProposal,
    getWorkspaceName,
    invoke,
    createInitializedWorkspace,
    navigationData,
    refreshNavigation,
    selectWorkspace,
    selectCreatedWorkspace,
    getCatalog,
    setProgress,
    setProposalError,
    setNewWorkView,
    setProposalView,
    getShowSession,
    setOwnerStatus,
    clearProposal,
    closeModal,
    formatWorkspaceError,
    setOwnerSetupBusy,
    syncPendingPrompt,
    setCreateDisabled,
    clearError,
    clearOwnerSetupNotice,
  } = deps;

  async function createWorkspace() {
    setCreateDisabled(true);
    setOwnerSetupBusy(true);
    clearError();
    clearOwnerSetupNotice();
    let ownerCreated = false;
    const proposal = getProposal();
    try {
      const workspaceName = getWorkspaceName().trim();
      if (!workspaceName) throw new Error("Workspace name is required.");
      if ((proposal.repositories || []).length > 1)
        throw new Error("A Workspace requires exactly one repository. Revise the proposal to select one repository.");
      setProgress("workspace", "Create workspace", "running");
      const initialized = await createInitializedWorkspace(
        invoke,
        workspaceName,
        proposal.repositories?.[0]?.repositoryId ?? null,
      );
      ownerCreated = true;
      selectWorkspace(initialized.workspace, navigationData());
      const data = await refreshNavigation();
      selectWorkspace(
        selectCreatedWorkspace(data, initialized.workspace),
        data,
      );
      await refreshNavigation();
      setProgress("workspace-result", "Workspace create", "success");
      setOwnerStatus("");
      setNewWorkView("closed");
      clearProposal();
      closeModal();
    } catch (error) {
      setProgress(
        "workspace-result",
        "Workspace create",
        "failed",
        String(error),
      );
      if (ownerCreated) {
        setNewWorkView("closed");
        clearProposal();
        closeModal();
        setOwnerStatus(formatWorkspaceError("Finish owner setup", error));
      } else setProposalError(formatWorkspaceError("Create work", error));
    } finally {
      setOwnerSetupBusy(false);
      syncPendingPrompt();
      setCreateDisabled(ownerCreated);
    }
  }
  return { createWorkspace };
}
