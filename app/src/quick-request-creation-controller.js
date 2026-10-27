export function createQuickRequestCreationController(deps) {
  const {
    getProposal, modelsReady, quickRequestDirectoryReady, getOriginalPrompt,
    getSelectedModel, getRepositoryId, proposalSessionId, invoke,
    submitResolvedQuickRequestFlow, waitForTerminal, onCreated, showSession,
    refreshRequests, setCreateDisabled, setOwnerSetupBusy, setProposalError,
    clearOwnerSetupNotice, setProgressProposalSession, setNewWorkView,
    clearProposal, closeDialog, closeProposalSession, setOwnerStatus,
    formatWorkspaceError, setAppNotice, clearPendingPromptAction,
    syncPendingPrompt,
  } = deps;

  async function createQuickRequest() {
    if (!getProposal() || !modelsReady()
      || !quickRequestDirectoryReady()) return;
    setCreateDisabled(true);
    setOwnerSetupBusy(true);
    setProposalError('');
    clearOwnerSetupNotice();
    setProgressProposalSession(proposalSessionId());
    let ownerCreated = false;
    try {
      const model = JSON.parse(getSelectedModel());
      await submitResolvedQuickRequestFlow({
        invoke,
        originalPrompt: getOriginalPrompt(),
        model,
        repositoryId: getRepositoryId() || null,
        waitForTerminal,
        onCreated: (record) => { ownerCreated = true; onCreated(record); },
        showSession,
        refreshRequests,
      });
      setNewWorkView('closed');
      clearProposal();
      closeDialog();
      if (proposalSessionId()) {
        try { await closeProposalSession(); }
        catch (error) { setOwnerStatus(formatWorkspaceError('Close proposal terminal', error)); }
      }
    } catch (error) {
      if (ownerCreated) {
        setNewWorkView('closed');
        clearProposal();
        closeDialog();
        const message = formatWorkspaceError('Finish owner setup', error);
        setOwnerStatus(message);
        setAppNotice(message);
        void refreshRequests().catch((refreshError) => {
          setAppNotice(`${message} · Quick Request list refresh failed: ${String(refreshError)}`);
        });
        clearPendingPromptAction();
      } else setProposalError(formatWorkspaceError('Create work', error));
    } finally {
      setOwnerSetupBusy(false);
      syncPendingPrompt();
      setCreateDisabled(ownerCreated || !quickRequestDirectoryReady());
    }
  }
  return { createQuickRequest };
}
