const acceptedTypes = new Set(["workspace", "quick_request"]);

export function createNewWorkModalController({
  getProposalSessionId,
  setWorkType,
    setView,
    setPrompt,
    setCaptureError,
    resetWorkspaceFields,
    modal,
    focusPrompt,
    focusWorkspace,
    closeProposalSession,
}) {
  async function cancel() {
    if (getProposalSessionId()) {
      try {
        await closeProposalSession();
      } catch {
        return;
      }
    }
    setView("closed");
    modal.close();
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
      if (!modal.isOpen()) modal.showModal();
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
