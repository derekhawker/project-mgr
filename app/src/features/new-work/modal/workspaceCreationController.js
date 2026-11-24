export const EMPTY_WORKSPACE_REPOSITORY = "__create_empty_repository__";

export function createWorkspaceCreationController(deps) {
  const {
    getGeneration,
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
    const generation = getGeneration?.();
    const isCurrent = () =>
      getGeneration?.() === undefined || getGeneration() === generation;
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
      if (!isCurrent()) {
        await refreshNavigation().catch(() => {});
        return;
      }
      setView("closed");
      closeModal();
      selectWorkspace(workspace, navigationData());
      try {
        const data = await refreshNavigation();
        if (isCurrent())
          selectWorkspace(selectCreatedWorkspace(data, workspace), data);
      } catch (error) {
        setNotice?.(
          formatWorkspaceError("Workspace created; refresh navigation", error),
        );
      }
    } catch (error) {
      if (isCurrent())
        setError(formatWorkspaceError("Create workspace", error));
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }

  return { create };
}
