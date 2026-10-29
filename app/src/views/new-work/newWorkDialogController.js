const acceptedTypes = new Set(["workspace", "quick_request"]);

export function createNewWorkDialogController({
  getProposalSessionId,
  setRequestedType,
  setWorkType,
  setView,
  setPrompt,
  setCaptureError,
  dialog,
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
    dialog.close();
  }
  return {
    open(workType = "workspace") {
      if (!acceptedTypes.has(workType)) return;
      setRequestedType(workType);
      setWorkType(workType);
      setView("capture");
      setPrompt("");
      setCaptureError("");
      if (!dialog.isOpen()) dialog.showModal();
      focusPrompt();
    },
    cancel,
    backToCapture() {
      setView("capture");
      focusPrompt();
    },
  };
}
