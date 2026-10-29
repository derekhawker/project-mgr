export function createNewWorkProposalController(deps) {
  const {
    getOriginalPrompt,
    getRequestedType,
    getSelectedModel,
    getProposalSessionId,
    setProposalSessionId,
    invoke,
    startNewWorkProposal,
    runNewWorkProposal,
    refreshCatalog,
    clearError,
    setBusy,
    resetProgress,
    setProgress,
    setProposalMode,
    closePriorProposalSession,
    renderProposal,
    showReview,
    formatWorkspaceError,
  } = deps;

  async function handleNewWorkCapture(event) {
    event.preventDefault();
    const originalPrompt = getOriginalPrompt();
    if (!originalPrompt.trim()) return;
    clearError();
    setBusy(true);
    resetProgress();
    setProgress("interpret", "Interpret request", "running");
    try {
      if (getProposalSessionId()) await closePriorProposalSession();
      const requestedType = getRequestedType();
      if (requestedType === "quick_request") await refreshCatalog();
      const selectedModel = JSON.parse(getSelectedModel());
      const started = await startNewWorkProposal(invoke, selectedModel);
      setProposalSessionId(started.sessionId);
      setProposalMode(true);
      // Proposal sessions are request/response-only and never enter the terminal registry.
      const proposal = await runNewWorkProposal(
        invoke,
        started.sessionId,
        originalPrompt,
        undefined,
        requestedType,
      );
      setProgress("interpret", "Interpret request", "success");
      await renderProposal(proposal, originalPrompt);
      showReview();
    } catch (failure) {
      setProgress("interpret", "Interpret request", "failed", String(failure));
      setCaptureError(formatWorkspaceError("Prepare proposal", failure));
    } finally {
      setBusy(false);
    }
  }

  const { setCaptureError } = deps;
  return { handleNewWorkCapture };
}
