import {
  addRepositoryDirectories,
  attachRepository,
  formatWorkspaceError,
  listRepositoryCatalog,
  loadRepositoryDirectoryPage,
  loadRepositoryLibraryRoot,
  saveRepositoryLibraryRoot,
  scanRepositories,
  softDeleteRepositories,
} from "../../services/shell.js";

export function createDirectoriesController({
  invoke,
  picker,
  getSelectedWorkspace,
  getNavigationData,
  getRepositoryCatalog,
  setRepositoryCatalog,
  refreshNavigation,
  refreshDocsAvailability,
  confirm,
  renderAttachedRepositories,
  setters,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
}) {
  const {
    setRepositoryStatus,
    setRepositoryError,
    setRepositoryDirectoriesBusy,
    setDirectoryGroups,
    setRepositoryLibraryPath,
    repositoryLibraryPath,
    setRepositoryLibraryStatus,
    setRepositoryLibraryError,
    setAttachRepositoryOptions,
    selectedAttachRepository,
    setSelectedAttachRepository,
    setOwnerStatus,
    setFullRequestVisible,
    setDirectoriesVisible,
    setNoSelectionVisible,
    setSelectedOwnerVisible,
    setWorkbenchVisible,
    setRightContentOwnerActive,
    setQuickRequestTerminalPage,
    setWorkspaceSelected,
  } = setters;
  let librarySaveTimer;
  let savedLibraryPath;
  let librarySaveInFlight;

  function scheduleLibrarySave() {
    cancelTimeout(librarySaveTimer);
    librarySaveTimer = scheduleTimeout(() => {
      librarySaveTimer = undefined;
      void saveLibrary();
    }, 5000);
  }

  function updateLibraryPath(path) {
    setRepositoryLibraryPath(path);
    setRepositoryLibraryError("");
    setRepositoryLibraryStatus("");
    scheduleLibrarySave();
  }

  async function refreshCatalog() {
    const repositories = await listRepositoryCatalog(invoke);
    setRepositoryCatalog(repositories);
    const options = repositories.map((repository) => ({
      id: repository.id,
      label: `${repository.name} — ${repository.repositoryPath}`,
    }));
    setAttachRepositoryOptions(options);
    if (!options.some((option) => option.id === selectedAttachRepository()))
      setSelectedAttachRepository("");
    const workspace = getSelectedWorkspace();
    if (workspace)
      renderAttachedRepositories(workspace.id, getNavigationData());
    return repositories;
  }

  async function refreshDirectories() {
    const page = await loadRepositoryDirectoryPage(invoke);
    const path = await loadRepositoryLibraryRoot(invoke);
    setRepositoryLibraryPath(path);
    savedLibraryPath = path;
    setDirectoryGroups(page.directories);
  }

  async function deleteRepositories(repositoryIds) {
    const selected = [...new Set(repositoryIds)];
    if (!selected.length) return;
    const count = selected.length;
    if (
      !confirm(
        `Delete ${count} selected repositories from the catalog? They will stay hidden when scanned again. Their files and existing workspace associations will remain.`,
      )
    )
      return;

    setRepositoryError("");
    try {
      await softDeleteRepositories(invoke, selected);
      setRepositoryStatus("");
      await refreshDirectories();
      await refreshCatalog();
      await refreshNavigation();
    } catch (error) {
      setRepositoryError(formatWorkspaceError("Delete repositories", error));
    }
  }

  async function addDirectories() {
    setRepositoryError("");
    setRepositoryDirectoriesBusy(true);
    setRepositoryStatus("Choose repository directories…");
    try {
      const result = await addRepositoryDirectories(invoke, picker, () =>
        setRepositoryStatus("Scanning selected directories…"),
      );
      if (!result) {
        setRepositoryStatus("");
        return;
      }
      await refreshCatalog();
      await refreshDirectories();
      const errors = result.errors || [];
      setRepositoryStatus(
        `Added ${result.repositories.length} repositories${errors.length ? "." : " to proposal context."}`,
      );
      if (errors.length) setRepositoryError(errors.join("; "));
    } catch (error) {
      setRepositoryStatus("");
      setRepositoryError(
        formatWorkspaceError("Add repository directories", error),
      );
    } finally {
      setRepositoryDirectoriesBusy(false);
    }
  }

  async function attach() {
    const workspace = getSelectedWorkspace();
    if (!workspace) {
      setOwnerStatus("Select a workspace first.");
      return;
    }
    const repository = (getRepositoryCatalog() || []).find(
      (entry) => entry.id === selectedAttachRepository(),
    );
    if (!repository) {
      setOwnerStatus("Select an enabled repository first.");
      return;
    }
    setOwnerStatus("Attaching repository…");
    try {
      const setup = await attachRepository(invoke, workspace.id, repository.id);
      setOwnerStatus(
        setup.setupStatus === "ready"
          ? `Attached independent workspace clone of ${repository.name}.`
          : `Repository setup needs attention: ${setup.errorDetail || setup.setupStatus}`,
      );
      await refreshNavigation();
      void refreshDocsAvailability();
    } catch (error) {
      setOwnerStatus(formatWorkspaceError("Attach", error));
    }
  }

  async function saveLibrary() {
    cancelTimeout(librarySaveTimer);
    librarySaveTimer = undefined;
    const path = repositoryLibraryPath();
    if (path === savedLibraryPath) return;
    if (librarySaveInFlight) {
      await librarySaveInFlight;
      if (repositoryLibraryPath() !== savedLibraryPath) return saveLibrary();
      return;
    }
    setRepositoryLibraryError("");
    setRepositoryLibraryStatus("Saving repository library location…");
    librarySaveInFlight = (async () => {
      try {
        const persistedPath = await saveRepositoryLibraryRoot(invoke, path);
        savedLibraryPath = persistedPath;
        if (repositoryLibraryPath() === path)
          setRepositoryLibraryPath(persistedPath);
        setRepositoryLibraryStatus("Repository library location saved.");
      } catch (error) {
        setRepositoryLibraryStatus("");
        setRepositoryLibraryError(
          formatWorkspaceError("Save repository library location", error),
        );
      } finally {
        librarySaveInFlight = undefined;
      }
    })();
    await librarySaveInFlight;
  }
  async function chooseLibrary() {
    setRepositoryLibraryError("");
    try {
      const selected = await picker({
        directory: true,
        multiple: false,
        title: "Choose repository library location",
      });
      if (typeof selected === "string") updateLibraryPath(selected);
    } catch (error) {
      setRepositoryLibraryError(
        `Choose repository library location failed: ${String(error)}`,
      );
    }
  }
  async function showPage() {
    setFullRequestVisible(false);
    setDirectoriesVisible(true);
    setNoSelectionVisible(false);
    setSelectedOwnerVisible(false);
    setWorkbenchVisible(false);
    setRightContentOwnerActive(false);
    setQuickRequestTerminalPage(false);
    setRepositoryError("");
    setRepositoryStatus("Loading directories…");
    try {
      await refreshDirectories();
      setRepositoryStatus("");
    } catch (error) {
      setRepositoryStatus("");
      setRepositoryError(formatWorkspaceError("Load Repositories", error));
    }
  }
  async function scanSavedDirectories() {
    const page = await loadRepositoryDirectoryPage(invoke);
    const roots = page.directories.map((entry) => entry.path);
    if (roots.length) await scanRepositories(invoke, roots);
    await refreshCatalog();
  }
  return {
    refreshCatalog,
    refreshDirectories,
    addDirectories,
    deleteRepositories,
    attach,
    saveLibrary,
    updateLibraryPath,
    chooseLibrary,
    showPage,
    scanSavedDirectories,
  };
}
