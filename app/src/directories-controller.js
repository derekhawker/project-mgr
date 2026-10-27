import {
  addRepositoryDirectories, attachRepository, formatWorkspaceError,
  listLegacyTaskArchives, listRepositoryCatalog,
  loadRepositoryDirectoryPage, loadRepositoryLibraryRoot, restoreLegacyTaskArchive,
  saveRepositoryLibraryRoot, scanRepositories,
} from './shell.js';
import { groupRepositoryDirectories } from './directory-groups.js';

export function createDirectoriesController({
  invoke, picker, getSelectedWorkspace, getNavigationData, getRepositoryCatalog, setRepositoryCatalog, refreshNavigation, refreshDocsAvailability, renderAttachedRepositories,
  setters,
}) {
  const {
    setRepositoryStatus, setRepositoryDirectoriesBusy, setDirectoryGroups,
    setRepositoryLibraryPath, repositoryLibraryPath, setRepositoryLibrarySaving,
    setRepositoryLibraryStatus, setLegacyArchives, setLegacyArchivesError,
    setRestoringLegacyArchives, setAttachRepositoryOptions,
    selectedAttachRepository, setSelectedAttachRepository, setOwnerStatus,
    setFullRequestVisible, setDirectoriesVisible, setNoSelectionVisible,
    setSelectedOwnerVisible, setWorkbenchVisible, setRightContentOwnerActive,
    setQuickRequestTerminalPage, setWorkspaceSelected,
  } = setters;

  async function refreshCatalog() {
    const repositories = await listRepositoryCatalog(invoke);
    setRepositoryCatalog(repositories);
    const options = repositories.map((repository) => ({ id: repository.id, label: `${repository.name} — ${repository.repositoryPath}` }));
    setAttachRepositoryOptions(options);
    if (!options.some((option) => option.id === selectedAttachRepository())) setSelectedAttachRepository('');
    const workspace = getSelectedWorkspace();
    if (workspace) renderAttachedRepositories(workspace.id, getNavigationData());
    return repositories;
  }

  async function refreshDirectories() {
    const page = await loadRepositoryDirectoryPage(invoke);
    setRepositoryLibraryPath(await loadRepositoryLibraryRoot(invoke));
    setDirectoryGroups(groupRepositoryDirectories(page.directories));
  }

  async function refreshArchives() {
    try {
      const archives = await listLegacyTaskArchives(invoke);
      setLegacyArchivesError(''); setLegacyArchives(archives);
    } catch (error) { setLegacyArchivesError(`Archive list unavailable: ${String(error)}`); }
  }

  async function addDirectories() {
    setRepositoryDirectoriesBusy(true); setRepositoryStatus('Choose repository directories…');
    try {
      const result = await addRepositoryDirectories(invoke, picker, () => setRepositoryStatus('Scanning selected directories…'));
      if (!result) { setRepositoryStatus(''); return; }
      await refreshCatalog(); await refreshDirectories();
      const errors = result.errors || [];
      setRepositoryStatus(errors.length ? `Added ${result.repositories.length} repositories. ${errors.join('; ')}` : `Added ${result.repositories.length} repositories to proposal context.`);
    } catch (error) { setRepositoryStatus(formatWorkspaceError('Add repository directories', error)); }
    finally { setRepositoryDirectoriesBusy(false); }
  }

  async function attach() {
    const workspace = getSelectedWorkspace();
    if (!workspace) { setOwnerStatus('Select a workspace first.'); return; }
    const repository = (getRepositoryCatalog() || []).find((entry) => entry.id === selectedAttachRepository());
    if (!repository) { setOwnerStatus('Select an enabled repository first.'); return; }
    setOwnerStatus('Attaching repository…');
    try {
      const setup = await attachRepository(invoke, workspace.id, repository.id);
      setOwnerStatus(setup.setupStatus === 'ready' ? `Attached independent workspace clone of ${repository.name}.` : `Repository setup needs attention: ${setup.errorDetail || setup.setupStatus}`);
      await refreshNavigation();
      void refreshDocsAvailability();
    } catch (error) { setOwnerStatus(formatWorkspaceError('Attach', error)); }
  }

  async function saveLibrary(event) {
    event.preventDefault(); setRepositoryLibrarySaving(true); setRepositoryLibraryStatus('Saving repository library location…');
    try { setRepositoryLibraryPath(await saveRepositoryLibraryRoot(invoke, repositoryLibraryPath())); setRepositoryLibraryStatus('Repository library location saved.'); }
    catch (error) { setRepositoryLibraryStatus(formatWorkspaceError('Save repository library location', error)); }
    finally { setRepositoryLibrarySaving(false); }
  }
  async function chooseLibrary() {
    try { const selected = await picker({ directory: true, multiple: false, title: 'Choose repository library location' }); if (typeof selected === 'string') setRepositoryLibraryPath(selected); }
    catch (error) { setRepositoryLibraryStatus(`Choose repository library location failed: ${String(error)}`); }
  }
  async function showPage() {
    await Promise.all([refreshDirectories(), refreshArchives()]);
    setFullRequestVisible(false); setDirectoriesVisible(true); setNoSelectionVisible(false);
    setSelectedOwnerVisible(false); setWorkbenchVisible(false); setRightContentOwnerActive(false); setQuickRequestTerminalPage(false);
  }
  async function restoreArchive(archive) {
    setRestoringLegacyArchives((records) => new Set(records).add(archive.taskId));
    try { await restoreLegacyTaskArchive(invoke, archive.taskId); setRepositoryStatus(`Legacy Task ${archive.taskId} restored to compatibility storage. Its files and OpenCode history were left untouched.`); await refreshArchives(); }
    catch (error) { setRepositoryStatus(`Restore legacy record failed: ${String(error)}`); setRestoringLegacyArchives((records) => { const next = new Set(records); next.delete(archive.taskId); return next; }); }
  }
  async function scanSavedDirectories() {
    const page = await loadRepositoryDirectoryPage(invoke);
    const roots = page.directories.map((entry) => entry.path);
    if (roots.length) await scanRepositories(invoke, roots);
    await refreshCatalog();
  }
  function returnFromPage() { setDirectoriesVisible(false); setNoSelectionVisible(true); setWorkspaceSelected(false); }
  return { refreshCatalog, refreshDirectories, refreshArchives, addDirectories, attach, saveLibrary, chooseLibrary, showPage, restoreArchive, scanSavedDirectories, returnFromPage };
}
