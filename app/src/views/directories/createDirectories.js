import { createSignal } from "solid-js";
import { createDirectoriesController } from "./directoriesController.js";
import { DirectoriesPage } from "./DirectoriesPage.jsx";
import { DirectoriesNavigationButton } from "./DirectoriesNavigationButton.jsx";
import { DirectoriesLibraryForm } from "./DirectoriesLibraryForm.jsx";
import { RepositoryDirectories } from "./RepositoryDirectories.jsx";
import {
  setRepositoryEnabled,
  formatWorkspaceError,
} from "../../services/shell.js";

// The Directories screen owns its form/list state, picker and refresh wiring.
// Workspace selection and destination visibility are supplied by the application.
export function createDirectories({
  invoke,
  picker,
  setRepositoryCatalog,
  refreshNavigation,
  confirm,
  destination,
  beforeOpen,
}) {
  const [repositoryLibraryPath, setRepositoryLibraryPath] = createSignal("");
  const [repositoryLibraryStatus, setRepositoryLibraryStatus] =
    createSignal("");
  const [repositoryLibraryError, setRepositoryLibraryError] = createSignal("");
  const [repositoryStatus, setRepositoryStatus] = createSignal("");
  const [repositoryError, setRepositoryError] = createSignal("");
  const [repositoryDirectoriesBusy, setRepositoryDirectoriesBusy] =
    createSignal(false);
  const [directoryGroups, setDirectoryGroups] = createSignal([]);
  const [pendingRepositoryId, setPendingRepositoryId] = createSignal(null);

  const controller = createDirectoriesController({
    invoke,
    picker,
    setRepositoryCatalog,
    refreshNavigation,
    confirm,
    setters: {
      setRepositoryStatus,
      setRepositoryError,
      setRepositoryDirectoriesBusy,
      setDirectoryGroups,
      setRepositoryLibraryPath,
      repositoryLibraryPath,
      setRepositoryLibraryStatus,
      setRepositoryLibraryError,
      ...destination.setters,
    },
  });

  async function toggleRepository(repository, enabled) {
    const previousEnabled = directoryGroups()
      .flatMap((group) => group.repositories)
      .find((entry) => entry.repository.id === repository.id)?.enabled;
    const updateEnabled = (value) =>
      setDirectoryGroups((groups) =>
        groups.map((group) => ({
          ...group,
          repositories: group.repositories.map((entry) =>
            entry.repository.id === repository.id
              ? { ...entry, enabled: value }
              : entry,
          ),
        })),
      );
    setPendingRepositoryId(repository.id);
    updateEnabled(enabled);
    try {
      await setRepositoryEnabled(invoke, repository.id, enabled);
      await controller.refreshDirectories();
      await controller.refreshCatalog();
    } catch (error) {
      updateEnabled(previousEnabled);
      setRepositoryStatus(formatWorkspaceError("Update repository", error));
    } finally {
      setPendingRepositoryId(null);
    }
  }

  async function showPage() {
    beforeOpen();
    return controller.showPage();
  }

  const libraryForm = () =>
    DirectoriesLibraryForm({
      path: repositoryLibraryPath,
      status: repositoryLibraryStatus,
      error: repositoryLibraryError,
      pageError: repositoryError,
      addingDirectories: repositoryDirectoriesBusy,
      onPathInput: controller.updateLibraryPath,
      onAddDirectories: controller.addDirectories,
      onSave: controller.saveLibrary,
      onChoose: controller.chooseLibrary,
    });

  return {
    attach: controller.attach,
    refreshCatalog: controller.refreshCatalog,
    scanSavedDirectories: controller.scanSavedDirectories,
    navigationButton: () =>
      DirectoriesNavigationButton({
        onOpen: () => {
          void showPage().catch((error) => setRepositoryError(String(error)));
        },
      }),
    page: () =>
      DirectoriesPage({
        visible: destination.visible,
        status: repositoryStatus,
        libraryForm,
        repositoryDirectories: () =>
          RepositoryDirectories({
            directories: directoryGroups,
            pendingRepositoryId,
            onToggleRepository: toggleRepository,
            onDeleteMany: controller.deleteRepositories,
          }),
      }),
  };
}
