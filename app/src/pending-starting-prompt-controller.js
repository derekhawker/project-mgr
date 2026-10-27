export function createPendingStartingPromptController(deps) {
  const {
    getPendingAction, getPromptText, invoke, showSession, submitStartingPrompt,
    setOwnerStatus, formatError, getOwnerSetupNotice, clearPendingAction,
    setPromptVisible, setPromptText, setDisabled,
  } = deps;

  async function submitPendingStartingPrompt() {
    const action = getPendingAction();
    if (!action) return;
    const promptText = getPromptText();
    if (!promptText.trim()) { setOwnerStatus('Enter a starting prompt first.'); return; }
    setDisabled(true);
    try {
      await showSession(action.sessionId);
      await submitStartingPrompt(invoke, action, promptText);
      if (action.type === 'quick_request') {
        setOwnerStatus('Quick Request started in its interactive terminal.');
      } else {
        setOwnerStatus(`${getOwnerSetupNotice() ? `${getOwnerSetupNotice()} ` : ''}Starting prompt submitted to the interactive terminal.`);
      }
      clearPendingAction();
      setPromptVisible(false);
      setPromptText('');
    } catch (error) {
      setOwnerStatus(formatError('Submit starting prompt', error));
    } finally {
      setDisabled(false);
    }
  }

  return { submitPendingStartingPrompt };
}
