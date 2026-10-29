// Keep menu callbacks stable while resolving the controller's current actions
// only when invoked. Reading the action signal at mount would freeze no-ops.
export function createRepositoryToolsActionForwarders(getActions) {
  return {
    onRun: (...args) => getActions().onRun(...args),
    onInstall: (...args) => getActions().onInstall(...args),
    onHandoff: (...args) => getActions().onHandoff(...args),
  };
}

export function createRepositoryToolsController({
  invoke,
  listRepositoryTools,
  getOwner,
  isOpen,
  setOpen,
  setDisabled,
  setGroups,
  setError,
  setActions,
  openRepositoryToolTerminal,
  openWorkbenchShellTerminal,
  launchWorkbenchOsHandoff,
  installStarted,
}) {
  async function toggleRepositoryTools() {
    if (isOpen()) {
      setOpen(false);
      return;
    }
    const owner = getOwner();
    if (!owner) return;
    const isCurrentOwner = () => {
      const current = getOwner();
      return current?.type === owner.type && current?.id === owner.id;
    };
    setDisabled(true);
    try {
      let groups = [];
      let loadError = "";
      try {
        groups = await listRepositoryTools(invoke, owner.type, owner.id);
      } catch (error) {
        loadError = `Could not load repository tools: ${String(error)}`;
      }
      if (!isCurrentOwner()) return;
      // Publishing groups can synchronously mount InstallControl and invoke
      // onInstall, even while the menu is hidden. Register this owner's actions
      // first so installation never uses the previous owner's callbacks.
      setActions({
        onRun: (repository, kind, name) => {
          if (isCurrentOwner())
            void openRepositoryToolTerminal(repository, kind, name);
        },
        onHandoff: async (action, view) => {
          if (!isCurrentOwner()) return;
          view.setDisabled(true);
          view.setHidden(false);
          view.setStatus(
            action === "shell" ? "Starting terminal…" : "Opening…",
          );
          try {
            if (action === "shell") {
              const started = await openWorkbenchShellTerminal(owner);
              if (!started)
                throw new Error(
                  "Terminal could not be started; see the workbench error.",
                );
            } else
              await launchWorkbenchOsHandoff(
                invoke,
                owner.type,
                owner.id,
                action,
              );
            view.setStatus("Opened successfully.");
          } catch (error) {
            view.setStatus(`Could not open: ${String(error)}`);
          } finally {
            view.setDisabled(false);
          }
        },
        onInstall: async (repository, view) => {
          if (!isCurrentOwner()) return;
          view.setHidden(true);
          const key = `${owner.type}:${owner.id}:${repository.repositoryId}:${repository.path}`;
          if (installStarted.has(key)) {
            view.setStatus("npm install is already running.");
            return;
          }
          installStarted.add(key);
          view.setStatus("Starting npm install…");
          const started = await openRepositoryToolTerminal(
            repository,
            "npm_install",
            "",
            key,
          );
          if (!started) installStarted.delete(key);
          view.setStatus(
            started
              ? "npm install opened in an interactive terminal."
              : "Could not start npm install; see the terminal error.",
          );
        },
      });
      setGroups(groups);
      setError(loadError);
      setOpen(true);
    } finally {
      setDisabled(false);
    }
  }
  return { toggleRepositoryTools };
}
