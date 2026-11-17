export function createQuickRequestCreationController(deps) {
  const {
    getProposal,
    modelsReady,
    quickRequestDirectoryReady,
    getOriginalPrompt,
    getSelectedModel,
    getRepositoryId,
    getDirectory,
    proposalSessionId,
    invoke,
    submitResolvedQuickRequestFlow,
    retryResolvedQuickRequestFlow,
    waitForTerminal,
    onCreated,
    showSession,
    refreshRequests,
    setCreateDisabled,
    setRecoveryBusy = () => {},
    setRecoveryRecord = () => {},
    finishQuickRequestStartup = async () => {},
    setOwnerSetupBusy,
    setProposalError,
    clearOwnerSetupNotice,
    setProgressProposalSession,
    setNewWorkView,
    clearProposal,
    closeModal,
    closeProposalSession,
    setOwnerStatus,
    formatWorkspaceError,
    setAppNotice,
    clearPendingPromptAction,
    syncPendingPrompt,
  } = deps;
  let recoveryRecord = null;
  let busy = false;

  function rememberCreatedRequest(record) {
    recoveryRecord = record;
    setRecoveryRecord(record);
    onCreated(record);
  }

  async function completeStartup(record) {
    await finishQuickRequestStartup(record);
    recoveryRecord = null;
    setRecoveryRecord(null);
    setNewWorkView("closed");
    clearProposal();
    closeModal();
    clearPendingPromptAction();
    if (proposalSessionId()) {
      try {
        await closeProposalSession();
      } catch (error) {
        setOwnerStatus(formatWorkspaceError("Close proposal terminal", error));
      }
    }
    try {
      await refreshRequests();
    } catch (error) {
      setAppNotice(
        `Quick Request started, but its list could not be refreshed: ${String(error)}`,
      );
    }
  }

  function setBusy(value) {
    busy = value;
    setOwnerSetupBusy(value);
    setRecoveryBusy(value);
  }

  async function createQuickRequest() {
    if (
      recoveryRecord ||
      busy ||
      !getProposal() ||
      !modelsReady() ||
      !quickRequestDirectoryReady()
    )
      return;
    setCreateDisabled(true);
    setBusy(true);
    setProposalError("");
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
        directory: getDirectory?.() || null,
        waitForTerminal,
        onCreated: (record) => {
          ownerCreated = true;
          rememberCreatedRequest(record);
        },
        showSession,
      });
      await completeStartup(recoveryRecord);
    } catch (error) {
      if (ownerCreated) {
        setProposalError(formatWorkspaceError("Start Quick Request", error));
      } else setProposalError(formatWorkspaceError("Create work", error));
    } finally {
      setBusy(false);
      syncPendingPrompt();
      setCreateDisabled(ownerCreated || !quickRequestDirectoryReady());
    }
  }

  async function retryQuickRequest() {
    const record = recoveryRecord;
    if (!record || busy) return;
    setRecoveryBusy(true);
    setOwnerSetupBusy(true);
    busy = true;
    setProposalError("");
    try {
      await retryResolvedQuickRequestFlow({
        invoke,
        record,
        model: JSON.parse(getSelectedModel()),
        showSession,
      });
      await completeStartup(record);
    } catch (error) {
      setProposalError(formatWorkspaceError("Recover Quick Request", error));
    } finally {
      busy = false;
      setRecoveryBusy(false);
      setOwnerSetupBusy(false);
      syncPendingPrompt();
    }
  }

  return { createQuickRequest, retryQuickRequest, hasRecovery: () => Boolean(recoveryRecord) };
}
