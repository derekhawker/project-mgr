export function createWorkspaceSessionFormController(deps) {
  const { createWorkspaceSession, invoke, getSelectedWorkspace, isModelsReady,
    getPrompt, getSelectedModel, showSession, setOwnerStatus, formatWorkspaceError,
    setSubmissionBusy, syncWorkspaceActionDisabled } = deps;

  async function startWorkspaceSessionFromForm(event) {
    event.preventDefault();
    if (!isModelsReady()) { setOwnerStatus('Models are still loading; try again shortly.'); return; }
    const workspace = getSelectedWorkspace();
    if (!workspace) { setOwnerStatus('Select an active workspace first.'); return; }
    setSubmissionBusy(true);
    syncWorkspaceActionDisabled();
    setOwnerStatus('Starting workspace session…');
    try {
      const selectedModel = JSON.parse(getSelectedModel());
      const record = await createWorkspaceSession(invoke, workspace.id, getPrompt(), selectedModel);
      await showSession(record.openCodeSessionId);
      setOwnerStatus('Workspace session started.');
    } catch (error) {
      setOwnerStatus(formatWorkspaceError('Workspace session', error));
    } finally {
      setSubmissionBusy(false);
      syncWorkspaceActionDisabled();
    }
  }

  return { startWorkspaceSessionFromForm };
}
