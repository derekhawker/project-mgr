export const EMPTY_WORKSPACE_REPOSITORY = "__create_empty_repository__";

export function createWorkspaceCreationController(deps) {
  const {
    getRepositoryChoice,
    getWorkspaceName,
    getWorkspaceDescription,
    invoke,
    createWorkspace,
    navigationData,
    refreshNavigation,
    selectWorkspace,
    selectCreatedWorkspace,
    setBusy,
    setError,
    setNotice,
    setView,
    closeModal,
    formatWorkspaceError,
  } = deps;

  async function create(event) {
    event?.preventDefault?.();
    const choice = getRepositoryChoice();
    const name = getWorkspaceName().trim();
    const isEmptyWorkspace = choice === EMPTY_WORKSPACE_REPOSITORY;
    if (!choice) {
      setError("Choose a registered repository or create an empty workspace.");
      return;
    }
    if (!name) {
      setError("Workspace title is required.");
      return;
    }
    const description = isEmptyWorkspace
      ? getWorkspaceDescription().trim()
      : null;
    if (isEmptyWorkspace && !description) {
      setError("A short description is required for an empty workspace.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const workspace = await createWorkspace(
        invoke,
        name,
        description,
        isEmptyWorkspace ? null : choice,
      );
      selectWorkspace(workspace, navigationData());
      setView("closed");
      closeModal();
      try {
        const data = await refreshNavigation();
        selectWorkspace(selectCreatedWorkspace(data, workspace), data);
      } catch (error) {
        setNotice?.(
          formatWorkspaceError("Workspace created; refresh navigation", error),
        );
      }
    } catch (error) {
      setError(formatWorkspaceError("Create workspace", error));
    } finally {
      setBusy(false);
    }
  }

  return { create };
}
