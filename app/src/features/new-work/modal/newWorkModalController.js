const acceptedTypes = new Set(["workspace", "quick_request"]);

export function createNewWorkModalController({
  getProposalSessionId,
  setRequestedType,
  setWorkType,
  setView,
  setPrompt,
  setCaptureError,
  modal,
  focusPrompt,
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
      setRequestedType(workType);
      setWorkType(workType);
      setView("capture");
      setPrompt("");
      setCaptureError("");
      if (!modal.isOpen()) modal.showModal();
      focusPrompt();
    },
    cancel,
    backToCapture() {
      setView("capture");
      focusPrompt();
    },
  };
}
