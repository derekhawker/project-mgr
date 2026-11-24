export function createNewWorkProposalController(deps) {
  const {
    getGeneration,
    isOpen = () => true,
    getOriginalPrompt,
    getExplicitDirectory,
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
    const generation = getGeneration?.();
    const isCurrent = () =>
      isOpen() &&
      (getGeneration?.() === undefined || getGeneration() === generation);
    const originalPrompt = getOriginalPrompt();
    if (!isCurrent() || !originalPrompt.trim()) return;
    clearError();
    setBusy(true);
    resetProgress();
    setProgress("interpret", "Interpret request", "running");
    try {
      if (getProposalSessionId()) {
        await closePriorProposalSession();
        if (!isCurrent()) return;
      }
      await refreshCatalog();
      if (!isCurrent()) return;
      const selectedModel = JSON.parse(getSelectedModel());
      const started = await startNewWorkProposal(invoke, selectedModel);
      setProposalSessionId(started.sessionId);
      if (!isCurrent()) {
        await closePriorProposalSession();
        return;
      }
      setProposalMode(true);
      // Proposal sessions are request/response-only and never enter the terminal registry.
      const proposal = await runNewWorkProposal(
        invoke,
        started.sessionId,
        originalPrompt,
        ...(getExplicitDirectory?.() ? [getExplicitDirectory()] : []),
      );
      if (!isCurrent()) return;
      setProgress("interpret", "Interpret request", "success");
      await renderProposal(proposal, originalPrompt, isCurrent);
      if (!isCurrent()) return;
      showReview();
    } catch (failure) {
      if (!isCurrent()) return;
      setProgress("interpret", "Interpret request", "failed", String(failure));
      setCaptureError(formatWorkspaceError("Prepare proposal", failure));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  const { setCaptureError } = deps;
  return { handleNewWorkCapture };
}
