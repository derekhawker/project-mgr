const acceptedTypes = new Set(["workspace", "quick_request"]);

export function createNewWorkModalController({
  getProposalSessionId,
  setWorkType,
  setView,
  setPrompt,
  setCaptureError,
  resetWorkspaceFields,
  focusPrompt,
  focusWorkspace,
  closeProposalSession,
}) {
  async function cancel() {
    const hasProposalSession = Boolean(getProposalSessionId());
    setView("closed");
    if (hasProposalSession) {
      try {
        await closeProposalSession();
      } catch {
        // The dialog is already closed. Cleanup failures are reported by the
        // stable proposal-session owner and must not resurrect modal content.
      }
    }
  }
  return {
    open(workType = "workspace") {
      if (!acceptedTypes.has(workType)) return;
      setWorkType(workType);
      if (workType === "workspace") {
        resetWorkspaceFields?.();
        setView("workspace");
      } else {
        setView("capture");
        setPrompt("");
        setCaptureError("");
      }
      if (workType === "workspace") focusWorkspace?.();
      else focusPrompt();
    },
    cancel,
    backToCapture() {
      setView("capture");
      focusPrompt();
    },
  };
}
