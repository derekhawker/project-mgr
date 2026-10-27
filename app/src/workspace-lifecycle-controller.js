export function createWorkspaceLifecycleController(deps) {
  const { getSelectedWorkspace, setSelectedWorkspace, completeWorkspace, reactivateWorkspace,
    invoke, setOwnerStatus, refreshNavigation, selectWorkspace, getNavigationData,
    formatWorkspaceError } = deps;

  async function handleCompleteWorkspace() {
    const workspace = getSelectedWorkspace();
    if (!workspace || workspace.status !== 'active') return;
    try {
      const result = await completeWorkspace(invoke, workspace.id);
      setSelectedWorkspace(result);
      setOwnerStatus('Workspace completed; homes, history, and running sessions were preserved.');
      await refreshNavigation();
      selectWorkspace(result, getNavigationData());
    } catch (error) { setOwnerStatus(formatWorkspaceError('Complete workspace', error)); }
  }

  async function handleReactivateWorkspace() {
    const workspace = getSelectedWorkspace();
    if (!workspace || workspace.status !== 'completed') return;
    try {
      const result = await reactivateWorkspace(invoke, workspace.id);
      setSelectedWorkspace(result);
      setOwnerStatus('Workspace reactivated. New sessions are enabled.');
      await refreshNavigation();
      selectWorkspace(result, getNavigationData());
    } catch (error) { setOwnerStatus(formatWorkspaceError('Reactivate workspace', error)); }
  }
  return { handleCompleteWorkspace, handleReactivateWorkspace };
}
