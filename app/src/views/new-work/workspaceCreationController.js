export function createWorkspaceCreationController(deps) {
  const {
    getProposal,
    getProposalSessionId,
    getSelectedModel,
    getStartingPrompt,
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
    showSession,
    workspaceSetupFailureDetails,
    hideWorkspaceRepositoryIds,
    workspaceStartingPromptSession,
    shouldSubmitWorkspaceStartingPrompt,
    submitNewWorkStartingPrompt,
    setOwnerStatus,
    clearProposal,
    closeDialog,
    closeProposalSession,
    formatWorkspaceError,
    setOwnerSetupBusy,
    syncPendingPrompt,
    setCreateDisabled,
    clearError,
    clearOwnerSetupNotice,
    setProposalSessionForProgress,
  } = deps;

  async function createWorkspace() {
    setCreateDisabled(true);
    setOwnerSetupBusy(true);
    clearError();
    clearOwnerSetupNotice();
    setProposalSessionForProgress(getProposalSessionId());
    let ownerCreated = false;
    const proposal = getProposal();
    try {
      const selectedModel = JSON.parse(getSelectedModel());
      const startingPrompt = getStartingPrompt();
      const workspaceName = getWorkspaceName().trim();
      if (!workspaceName) throw new Error("Workspace name is required.");
      setProgress("workspace", "Create workspace", "running");
      const initialized = await createInitializedWorkspace(
        invoke,
        workspaceName,
        selectedModel,
        proposal.workspace.intent || null,
        getProposalSessionId(),
      );
      ownerCreated = true;
      selectWorkspace(initialized.workspace, navigationData());
      const data = await refreshNavigation();
      selectWorkspace(
        selectCreatedWorkspace(data, initialized.workspace),
        data,
      );
      const setupFailures = initialized.setup.filter(
        (entry) => entry.setupStatus === "failed",
      );
      const sessionErrors = initialized.sessionErrors || [];
      await refreshNavigation();
      const recovery = (message, actionLabel) => {
        setNewWorkView("review");
        setProposalError(message);
        setProposalView((current) => ({
          ...current,
          createLabel: actionLabel,
        }));
      };
      if (setupFailures.length) {
        setProgress(
          "workspace-result",
          "Workspace create",
          "failed",
          workspaceSetupFailureDetails(
            setupFailures,
            proposal.repositories,
            getCatalog(),
          ),
        );
        recovery(
          "Workspace create failed. Review the failed repository step(s), then choose Retry setup.",
          "Retry setup",
        );
        ownerCreated = false;
        return;
      }
      const workspaceSessions = initialized.sessions || [];
      for (const session of workspaceSessions)
        await showSession(session.openCodeSessionId);
      if (sessionErrors.length) {
        setProgress(
          "workspace-result",
          "Workspace create",
          "failed",
          hideWorkspaceRepositoryIds(
            sessionErrors.join("\n"),
            proposal.repositories,
            getCatalog(),
          ),
        );
        recovery(
          "Workspace create failed while starting a terminal. Review the details, then choose Retry session.",
          "Retry session",
        );
        ownerCreated = false;
        return;
      }
      if (!workspaceSessions.length) {
        setProgress(
          "workspace-result",
          "Workspace create",
          "failed",
          "No workspace terminal was created.",
        );
        recovery(
          "Workspace create failed: no terminal was created.",
          "Retry session",
        );
        ownerCreated = false;
        return;
      }
      const startingPromptSession = workspaceStartingPromptSession(
        workspaceSessions,
        navigationData().workspaceSessionContexts,
      );
      if (!startingPromptSession)
        throw new Error("No tracked Workspace session is available.");
      await showSession(startingPromptSession.openCodeSessionId);
      if (shouldSubmitWorkspaceStartingPrompt(startingPrompt)) {
        const action = {
          type: "workspace",
          ownerKey: `workspace:${initialized.workspace.id}`,
          sessionId: startingPromptSession.openCodeSessionId,
          model: selectedModel,
        };
        setProgress("starting-prompt", "Submit starting prompt", "running");
        await submitNewWorkStartingPrompt(invoke, action, startingPrompt);
        setProgress("starting-prompt", "Submit starting prompt", "success");
      } else
        setProgress(
          "starting-prompt",
          "Submit starting prompt",
          "skipped",
          "No starting prompt was provided.",
        );
      setProgress("workspace-result", "Workspace create", "success");
      setOwnerStatus("");
      setNewWorkView("closed");
      clearProposal();
      closeDialog();
      const proposalSessionId = getProposalSessionId();
      if (proposalSessionId) {
        try {
          await closeProposalSession();
        } catch (error) {
          setOwnerStatus(
            formatWorkspaceError("Close proposal terminal", error),
          );
        }
      }
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
        closeDialog();
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
