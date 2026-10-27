import '@xterm/xterm/css/xterm.css';
import { invokeCommand } from './command-contract.js';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { open as tauriOpenDirectoryPicker } from '@tauri-apps/plugin-dialog';
import { loadApplicationShell } from './shell.js';
import { hideWorkspaceRepositoryIds, workspaceProgressPresentation, workspaceSetupFailureDetails } from './workspace-setup-progress.js';
import { listQuickRequests, restoreQuickRequest, deleteQuickRequest, loadWorkspaceNavigation, listLegacyTaskArchives, restoreLegacyTaskArchive, createInitializedWorkspace, createWorkspaceSession, submitNewWorkStartingPrompt, shouldSubmitWorkspaceStartingPrompt, workspaceStartingPromptSession, addRepositoryDirectories, scanRepositories, listRepositoryCatalog, loadRepositoryDirectoryPage, loadRepositoryLibraryRoot, saveRepositoryLibraryRoot, setRepositoryEnabled, attachRepository, formatWorkspaceError, selectCreatedWorkspace, listPendingInputs, listAllPendingInputs, getSessionStatus, reconcileSession, sessionStatusLabel, completeWorkspace, reactivateWorkspace, terminalAccessibilityAttributes, controlErrorAttributes, startNewWorkProposal, runNewWorkProposal, closeNewWorkProposal, cleanupTerminal, resolveQuickRequestDirectory, submitResolvedQuickRequestFlow, createKeyedSingleFlight, workspaceProposalRepositoryLocations, workspaceSessionTabLabel } from './shell.js';
import './styles.css';
import { showCleanupError } from './error-events.js';
import { createQuickRequestFormView, createQuickRequestSubmitHandler } from './quick-request-form.js';
import { createQuickRequestHistoryController } from './quick-request-history-controller.js';
import { createQuickRequestSelection } from './quick-request-selection.js';
import { createWorkspaceNavigationController } from './workspace-navigation-controller.js';
import { createPendingStartingPromptController } from './pending-starting-prompt-controller.js';
import { createNewWorkProposalController } from './new-work-proposal-controller.js';
import { createNewWorkDialogController } from './new-work-dialog-controller.js';
import { initializeModelSelector, modelSelectorChoices } from './model-selector.js';
import { recordSessionReplacement, resolveSessionReplacement } from './session-restore-ui.js';
import { loadChangeReview } from './change-review-ui.js';
import { createChangeReviewController } from './change-review-controller.js';
import { createRepositoryToolsActionForwarders, createRepositoryToolsController } from './repository-tools-controller.js';
import { createDocsController } from './docs-controller.js';
import { createDocsView } from './docs-view.js';
import { listRepositoryTools, startRepositoryTool, startWorkbenchShell, launchWorkbenchOsHandoff, repoToolTerminalCommand } from './repo-tools-ui.js';
import { groupRepositoryDirectories } from './directory-groups.js';
import { handleEnterToSubmit } from './form-keyboard.js';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createApplicationLifetime } from './application-lifetime.js';
import { WorkspaceNavigation } from './workspace-navigation.jsx';
import { RepositoryDirectories } from './repository-directories.jsx';
import { QuickRequestList } from './quick-request-list.jsx';
import { SessionTabList } from './session-tab-list.jsx';
import { handleSessionTabKeydown } from './session-tab-keyboard.js';
import { ownerSessionTabState, restoreOwnerSessionTabs } from './session-tab-state.js';
import { ChangeReviewPanel } from './change-review-panel.jsx';
import { DocsPane } from './docs-pane.jsx';
import { RepositoryToolsMenu } from './repository-tools-menu.jsx';
import { LegacyArchivesList } from './legacy-archives-list.jsx';
import { NewWorkMenu } from './new-work-menu.jsx';
import { NewWorkDialog } from './new-work-dialog.jsx';
import { WorkspaceOwnerPanel } from './workspace-owner-panel.jsx';
import { ApplicationShellStatus } from './application-shell-status.jsx';
import { createApplicationShellView } from './application-shell-view.js';
import { ProposalRepositoryList } from './proposal-repository-list.jsx';
import { AppNotice } from './app-notice.jsx';
import { PendingInputList } from './pending-input-list.jsx';
import { QuickRequestHistoryPage } from './quick-request-history-page.jsx';
import { DirectoriesLibraryForm } from './directories-library-form.jsx';
import { DirectoriesPage } from './directories-page.jsx';
import { WorkbenchShell } from './workbench-shell.jsx';
import { NoSelection } from './no-selection.jsx';
import { DirectoriesNavigationButton } from './directories-navigation-button.jsx';
import { QuickRequestHistoryButton } from './quick-request-history-button.jsx';
import { RightContentShell } from './right-content-shell.jsx';
import { createDirectoriesController } from './directories-controller.js';
import { createWorkspaceLifecycleController } from './workspace-lifecycle-controller.js';
import { createWorkspaceSessionFormController } from './workspace-session-form-controller.js';
import { createWorkspaceCreationController } from './workspace-creation-controller.js';
import { createQuickRequestCreationController } from './quick-request-creation-controller.js';
import { prepareProposalReview } from './new-work-proposal-review.js';
import { isBrowserFixture } from './runtime-mode.js';

const browserFixture = isBrowserFixture(import.meta.env.DEV, Boolean(window.__TAURI_INTERNALS__));
const listen = browserFixture ? async () => () => {} : tauriListen;
const openDirectoryPicker = browserFixture ? async () => { throw new Error('Browser fixture does not access local directories.'); } : tauriOpenDirectoryPicker;

// Bootstrap wiring/mount phase. Parent islands mount before their child roots.
// Events and controller-to-controller actions forward lazily to later bindings;
// signal/dependency values must already exist at each eager factory/mount read.
// No command loads, native app subscriptions, or terminal startup run until the
// final launch phase. Install the page teardown hook before allocating islands.
const appLifetime = createApplicationLifetime({
  render, listen, windowTarget: window,
  onError: (error) => {
    console.error(error);
    setAppNotice(`Application event subscription/cleanup failed: ${String(error)}`);
  },
});
const renderSolid = appLifetime.mount;
if (import.meta.hot) import.meta.hot.dispose(() => appLifetime.dispose());
const [rightContentOwnerActive, setRightContentOwnerActive] = createSignal(false);
const [quickRequestTerminalPage, setQuickRequestTerminalPage] = createSignal(false);
renderSolid(() => RightContentShell({ ownerActive: rightContentOwnerActive, quickRequestTerminalPage }), document.querySelector('#right-content-root'));

// Command-boundary client.  Raw Tauri invoke is intentionally not available
// in this module or any other production presentation module.
const invoke = (name, payload) => {
  // Pending UI continuations must not issue cleanup/start commands after unload
  // or HMR. Already-running Rust work remains owned by Rust, not this page.
  if (appLifetime.disposed) return Promise.reject(new Error('Application presentation has been disposed.'));
  return payload === undefined ? invokeCommand(name) : invokeCommand(name, payload);
};
let quickRequestSubmitHandler;
function handleQuickRequestSubmit(event) {
  return quickRequestSubmitHandler?.(event);
}

const [newWorkView, setNewWorkView] = createSignal('closed');
const [newWorkType, setNewWorkType] = createSignal('workspace');
const [quickRequestDirectories, setQuickRequestDirectories] = createSignal([]);
const [quickRequestDirectoryId, setQuickRequestDirectoryId] = createSignal('');
const [quickRequestDirectoryPath, setQuickRequestDirectoryPath] = createSignal('');
const [proposalView, setProposalView] = createSignal({
  workType: 'workspace', title: 'Check the proposed context', workspaceName: '',
  workspaceDirectory: '', originalPrompt: '', startingPrompt: '', createLabel: 'Create',
});
const [reviewWorkspaceName, setReviewWorkspaceName] = createSignal('');
const [reviewStartingPrompt, setReviewStartingPrompt] = createSignal('');
const [progressVisible, setProgressVisible] = createSignal(false);
const [progressRows, setProgressRows] = createSignal(new Map());
const [newWorkCaptureError, setNewWorkCaptureError] = createSignal('');
const [proposalError, setProposalError] = createSignal('');
const [proposalCreateDisabled, setProposalCreateDisabled] = createSignal(true);
const [proposalModelDisabled, setProposalModelDisabled] = createSignal(true);
const [proposalModels, setProposalModels] = createSignal([]);
const [proposalSelectedModel, setProposalSelectedModel] = createSignal('');
const [newWorkCaptureDisabled, setNewWorkCaptureDisabled] = createSignal(false);
const [newWorkPromptValue, setNewWorkPromptValue] = createSignal('');
renderSolid(() => NewWorkDialog({
  proposal: proposalView,
  workspaceName: reviewWorkspaceName,
  setWorkspaceName: setReviewWorkspaceName,
  startingPrompt: reviewStartingPrompt,
  setStartingPrompt: setReviewStartingPrompt,
  workType: newWorkType,
  captureVisible: () => newWorkView() === 'capture',
  reviewVisible: () => newWorkView() === 'review',
  progressVisible,
  progressRows,
  captureError: newWorkCaptureError,
  proposalError,
  proposalCreateDisabled,
  proposalModelDisabled,
  proposalModels,
  proposalSelectedModel,
  setProposalSelectedModel,
  captureDisabled: newWorkCaptureDisabled,
  prompt: newWorkPromptValue,
  setPrompt: setNewWorkPromptValue,
  onCapture: (event) => handleNewWorkCapture(event),
  onEnterToSubmit: handleEnterToSubmit,
  onBack: () => backToNewWorkCapture(),
  onCancel: () => cancelNewWork(),
  onDialogCancel: (event) => cancelNewWorkDialog(event),
  onConfirm: createProposedWork,
  onDirectoryChange: changeQuickRequestDirectory,
  directories: quickRequestDirectories,
  directoryId: quickRequestDirectoryId,
  directoryPath: quickRequestDirectoryPath,
}), document.querySelector('#new-work-dialog-root'));
const [attachedRepositoryRows, setAttachedRepositoryRows] = createSignal([]);
const [ownerTitle, setOwnerTitle] = createSignal('');
const [ownerDescription, setOwnerDescription] = createSignal('');
const [ownerStatus, setOwnerStatus] = createSignal('');
const [sessionStatusMessage, setSessionStatusMessage] = createSignal('');
const [pendingPromptVisible, setPendingPromptVisible] = createSignal(false);
const [pendingPromptDisabled, setPendingPromptDisabled] = createSignal(false);
const [pendingPromptText, setPendingPromptText] = createSignal('');
const [pendingPromptLabel, setPendingPromptLabel] = createSignal('Start workspace session');
const pendingStartingPromptController = createPendingStartingPromptController({
  getPendingAction: () => pendingPromptAction,
  getPromptText: pendingPromptText,
  invoke,
  showSession: (...args) => showSession(...args),
  submitStartingPrompt: submitNewWorkStartingPrompt,
  setOwnerStatus,
  formatError: formatWorkspaceError,
  getOwnerSetupNotice: () => ownerSetupNotice,
  clearPendingAction: () => { pendingPromptAction = null; },
  setPromptVisible: setPendingPromptVisible,
  setPromptText: setPendingPromptText,
  setDisabled: setPendingPromptDisabled,
});
const [ownerIsQuickRequest, setOwnerIsQuickRequest] = createSignal(false);
const [completeWorkspaceDisabled, setCompleteWorkspaceDisabled] = createSignal(true);
const [reactivateWorkspaceDisabled, setReactivateWorkspaceDisabled] = createSignal(true);
const [attachRepositoryDisabled, setAttachRepositoryDisabled] = createSignal(true);
const [attachRepositoryOptions, setAttachRepositoryOptions] = createSignal([]);
const [selectedAttachRepository, setSelectedAttachRepository] = createSignal('');
const [workspaceSessionSubmitDisabled, setWorkspaceSessionSubmitDisabled] = createSignal(true);
const [workspacePrompt, setWorkspacePrompt] = createSignal('');
const [quickModelOptions, setQuickModelOptions] = createSignal([]);
const [quickSelectedModel, setQuickSelectedModel] = createSignal('');
const [quickModelDisabled, setQuickModelDisabled] = createSignal(true);
const [quickModelBusy, setQuickModelBusy] = createSignal(true);
const [quickModelError, setQuickModelError] = createSignal('');
const [quickRequestError, setQuickRequestError] = createSignal('');
const quickRequestFormView = createQuickRequestFormView();
const [terminalRuntimeStartupFailed, setTerminalRuntimeStartupFailed] = createSignal(false);
const [selectedOwnerVisible, setSelectedOwnerVisible] = createSignal(false);
const [proposalMode, setProposalMode] = createSignal(false);
const [quickRequestTerminalActionsVisible, setQuickRequestTerminalActionsVisible] = createSignal(false);
const [proposalRepositoryRows, setProposalRepositoryRows] = createSignal([]);
renderSolid(() => ProposalRepositoryList({ repositories: proposalRepositoryRows }), document.querySelector('#proposal-repositories'));
renderSolid(() => WorkspaceOwnerPanel({
  repositories: attachedRepositoryRows,
  title: ownerTitle,
  description: ownerDescription,
  status: ownerStatus,
  sessionStatus: sessionStatusMessage,
  pendingPromptVisible,
  pendingPromptDisabled,
  pendingPromptText,
  pendingPromptLabel,
  quickRequest: ownerIsQuickRequest,
  completeWorkspaceDisabled,
  reactivateWorkspaceDisabled,
  attachRepositoryDisabled,
  attachRepositoryOptions,
  selectedAttachRepository,
  onAttachRepositoryChange: (event) => setSelectedAttachRepository(event.currentTarget.value),
  workspaceSessionSubmitDisabled,
  workspacePrompt,
  terminalRuntimeStartupFailed,
  modelOptions: quickModelOptions,
  selectedModel: quickSelectedModel,
  modelDisabled: quickModelDisabled,
  modelBusy: quickModelBusy,
  modelError: quickModelError,
  quickRequestError,
  quickPrompt: quickRequestFormView.getPrompt,
  onQuickPromptInput: quickRequestFormView.setPrompt,
  quickRequestBusy: quickRequestFormView.isBusy,
  onModelChange: (event) => setQuickSelectedModel(event.currentTarget.value),
  visible: selectedOwnerVisible,
  proposalMode,
  quickRequestTerminalActions: quickRequestTerminalActionsVisible,
  onQuickRequestBack: returnFromQuickRequest,
  onSubmitStartingPrompt: () => submitPendingStartingPrompt(),
  onPendingPromptTextInput: setPendingPromptText,
  onWorkspaceSessionSubmit: (event) => startWorkspaceSessionFromForm(event),
  onEnterToSubmit: handleEnterToSubmit,
  onWorkspacePromptInput: setWorkspacePrompt,
  onCompleteWorkspace: () => handleCompleteWorkspace(),
  onReactivateWorkspace: () => handleReactivateWorkspace(),
  onAttachRepository: handleAttachRepository,
  onQuickRequestSubmit: handleQuickRequestSubmit,
}), document.querySelector('#workspace-owner-panel-root'));

const shellView = createApplicationShellView();
const setCommandResultMessage = shellView.setResult;
renderSolid(() => ApplicationShellStatus({ state: shellView.state }), document.querySelector('#application-status-root'));
const [appNoticeMessage, setAppNoticeMessage] = createSignal('');
renderSolid(() => AppNotice({ message: appNoticeMessage }), document.querySelector('#app-notice-root'));
const [pendingInputRows, setPendingInputRows] = createSignal([]);
const [pendingInputMessage, setPendingInputMessage] = createSignal('');
const [repositoryLibraryPath, setRepositoryLibraryPath] = createSignal('');
const [repositoryLibraryStatus, setRepositoryLibraryStatus] = createSignal('');
const [repositoryLibrarySaving, setRepositoryLibrarySaving] = createSignal(false);
const [directoriesVisible, setDirectoriesVisible] = createSignal(false);
const [repositoryStatus, setRepositoryStatus] = createSignal('');
const [repositoryDirectoriesBusy, setRepositoryDirectoriesBusy] = createSignal(false);
renderSolid(() => DirectoriesPage({ visible: directoriesVisible, status: repositoryStatus, onBack: returnFromDirectories }), document.querySelector('#directories-page-root'));
renderSolid(() => DirectoriesNavigationButton({ onOpen: () => {
  void showDirectoriesPage().catch((error) => { setRepositoryStatus(String(error)); });
} }), document.querySelector('#show-directories-root'));
renderSolid(() => QuickRequestHistoryButton({ onShow: () => {
  void showQuickRequestList().catch((error) => { setQuickRequestError(String(error)); });
} }), document.querySelector('#show-history-root'));
renderSolid(() => DirectoriesLibraryForm({
  path: repositoryLibraryPath,
  status: repositoryLibraryStatus,
  saving: repositoryLibrarySaving,
  addingDirectories: repositoryDirectoriesBusy,
  onPathInput: setRepositoryLibraryPath,
  onAddDirectories: addRepositoryDirectoriesAction,
  onSave: saveRepositoryLibraryLocation,
  onChoose: chooseRepositoryLibraryLocation,
}), document.querySelector('#directories-library-form-root'));
renderSolid(() => PendingInputList({
  items: pendingInputRows,
  message: pendingInputMessage,
  onOpen: (sessionId) => { showOwnerTerminal(); void showSession(sessionId); },
}), document.querySelector('#pending-inputs'));

function setAppNotice(message) {
  setAppNoticeMessage(message);
}

function resetProgress(sessionId = null) {
  progressProposalSessionId = sessionId;
  setProgressRows(new Map());
  setProgressVisible(true);
}

function setProgress(key, label, status, detail = null) {
  setProgressRows((rows) => new Map(rows).set(key, { label, status, detail }));
}

const list = document.querySelector('#quick-request-list');
const terminalViews = document.querySelector('#terminal-views');
let selectedWorkspace = null;
const { selectedQuickRequest, setSelectedQuickRequest, selectedId: selectedQuickRequestId } = createQuickRequestSelection();
let navigationData = { workspaces: [], tasks: [], sessions: [], workspaceRepositories: [], workspaceSessionContexts: [] };
const [recentQuickRequests, setRecentQuickRequests] = createSignal([]);
const [allQuickRequests, setAllQuickRequests] = createSignal([]);
const [fullRequestVisible, setFullRequestVisible] = createSignal(false);
let historyQuery = '';
renderSolid(() => QuickRequestList({
  records: recentQuickRequests,
  history: () => false,
  query: () => '',
  selectedId: selectedQuickRequestId,
  onOpen: (record) => void openQuickRequestRecord(record),
  onDelete: (record) => void deleteQuickRequestRecord(record, false),
}), list);
renderSolid(() => QuickRequestHistoryPage({
  visible: fullRequestVisible,
  records: allQuickRequests,
  selectedId: selectedQuickRequestId,
  onNew: () => openNewWork('quick_request'),
  onSearch: (query) => { historyQuery = query; void refreshRequests(true).catch((error) => setAppNotice(formatWorkspaceError('Search Quick Requests', error))); },
  onOpen: (record) => void openQuickRequestRecord(record),
  onDelete: (record) => void deleteQuickRequestRecord(record, true),
}), document.querySelector('#quick-request-history-root'));
const [workspaceNavigation, setWorkspaceNavigation] = createSignal({ data: navigationData, selected: null });
const [navigationBusy, setNavigationBusy] = createSignal(true);
renderSolid(() => WorkspaceNavigation({
  data: () => workspaceNavigation().data,
  selected: () => workspaceNavigation().selected,
  busy: navigationBusy,
  onSelect: (workspace) => selectWorkspace(workspace, navigationData),
}), document.querySelector('#workspace-navigation-root'));
const [directoryGroups, setDirectoryGroups] = createSignal([]);
const [pendingRepositoryId, setPendingRepositoryId] = createSignal(null);
const directoryList = document.querySelector('#directory-list');
renderSolid(() => RepositoryDirectories({
  groups: directoryGroups,
  pendingRepositoryId,
  onToggle: async (repository, enabled) => {
    const previousEnabled = directoryGroups().flatMap((group) => group.repositories).find((entry) => entry.repository.id === repository.id)?.enabled;
    setPendingRepositoryId(repository.id);
    setDirectoryGroups((groups) => groups.map((group) => ({ ...group, repositories: group.repositories.map((entry) => entry.repository.id === repository.id ? { ...entry, enabled } : entry) })));
    try {
      await setRepositoryEnabled(invoke, repository.id, enabled);
      await refreshDirectories();
      await refreshCatalog();
    } catch (error) {
      setDirectoryGroups((groups) => groups.map((group) => ({ ...group, repositories: group.repositories.map((entry) => entry.repository.id === repository.id ? { ...entry, enabled: previousEnabled } : entry) })));
      setRepositoryStatus(formatWorkspaceError('Update repository', error));
    } finally { setPendingRepositoryId(null); }
  },
}), directoryList);
const [legacyArchives, setLegacyArchives] = createSignal([]);
const [legacyArchivesError, setLegacyArchivesError] = createSignal('');
const [restoringLegacyArchives, setRestoringLegacyArchives] = createSignal(new Set());
renderSolid(() => LegacyArchivesList({
  records: legacyArchives,
  error: legacyArchivesError,
  isRestoring: (taskId) => restoringLegacyArchives().has(taskId),
  onRestore: (archive) => void restoreLegacyArchiveRecord(archive),
}), document.querySelector('#legacy-task-archives'));
const [sessionTabEntries, setSessionTabEntries] = createSignal([]);
function addSessionTab(entry) {
  setSessionTabEntries((entries) => entries.some((item) => item.sessionId === entry.sessionId)
    ? entries : [...entries, entry]);
}
function removeSessionTab(sessionId) {
  setSessionTabEntries((entries) => entries.filter((entry) => entry.sessionId !== sessionId));
}
function updateSessionTab(sessionId, changes) {
  setSessionTabEntries((entries) => entries.map((entry) => entry.sessionId === sessionId
    ? { ...entry, ...changes } : entry));
}
const openSessions = new Set();
const sessionOwners = new Map();
const selectedSessionByOwner = new Map();
const sessionDirectories = new Map();
const missingSessionReplacements = new Map();
let modelsReady = false;
let currentProposal = null;
let quickRequestDirectoryReady = false;
let proposalSessionId = null;
let progressProposalSessionId = null;
let pendingPromptAction = null;
let ownerSetupNotice = '';
let ownerSetupBusy = false;
const [noSelectionVisible, setNoSelectionVisible] = createSignal(true);
const [workspaceSelected, setWorkspaceSelected] = createSignal(false);
renderSolid(() => NoSelection({ visible: noSelectionVisible, workspaceSelected }), document.querySelector('#no-selection-root'));
const selectedOwner = document.querySelector('#selected-owner');
const [workbenchVisible, setWorkbenchVisible] = createSignal(false);
const [changeReviewAvailable, setChangeReviewAvailable] = createSignal(false);
const [changeReviewSelected, setChangeReviewSelected] = createSignal(false);
const [changeReviewDisabled, setChangeReviewDisabled] = createSignal(false);
const docsView = createDocsView();
const { buttonDisabled: docsDisabled, buttonSelected: docsButtonSelected, setButtonSelected: setDocsButtonSelected } = docsView;
renderSolid(() => WorkbenchShell({ visible: workbenchVisible, changeReviewAvailable, changeReviewSelected, changeReviewDisabled, docsDisabled, docsButtonSelected, onOpenDocs: () => void docsController.open(), onOpenChangeReview: (event) => handleChangeReviewClick(event), onSessionTabKeydown: (event) => handleSessionTabKeydown(event, sessionTabEntries(), {
  activeSessionId: sessionTabs.ownerDocument.activeElement?.dataset.sessionId,
  focusTab: (sessionId) => sessionTabs.ownerDocument.getElementById(`session-tab-${sessionId}`)?.focus(),
}) }), document.querySelector('#workbench-root'));
const sessionTabs = document.querySelector('#session-tabs');
renderSolid(() => SessionTabList({ tabs: sessionTabEntries }), sessionTabs);
const [changeReviewVisible, setChangeReviewVisible] = createSignal(false);
const [changeReviewRepositories, setChangeReviewRepositories] = createSignal([]);
const [changeReviewError, setChangeReviewError] = createSignal('');
const [changeReviewMode, setChangeReviewMode] = createSignal('unified');
const [changeReviewSummary, setChangeReviewSummary] = createSignal('');
renderSolid(() => ChangeReviewPanel({
  repositories: changeReviewRepositories,
  visible: changeReviewVisible,
  error: changeReviewError,
  mode: changeReviewMode,
  summary: changeReviewSummary,
  onMode: setChangeReviewMode,
  onBack: () => showOwnerTerminal(),
}), document.querySelector('#change-review-root'));
renderSolid(() => DocsPane({
  ...docsView,
  onSelect: (file) => void docsController.select(file.path, file.repositoryId),
}), document.querySelector('#docs-root'));
const docsController = createDocsController({
  invoke,
  getOwner: () => selectedWorkspace ? { type: 'workspace', id: selectedWorkspace.id } : null,
  view: docsView,
  onOpen: () => {
    setChangeReviewVisible(false);
    setChangeReviewSelected(false);
    setSelectedOwnerVisible(false);
  },
});
const [repositoryToolGroups, setRepositoryToolGroups] = createSignal([]);
const [repositoryToolLoadError, setRepositoryToolLoadError] = createSignal('');
const [repositoryToolsOpen, setRepositoryToolsOpen] = createSignal(false);
const [repositoryToolsAvailable, setRepositoryToolsAvailable] = createSignal(false);
const [repositoryToolsDisabled, setRepositoryToolsDisabled] = createSignal(false);
const [repositoryToolActions, setRepositoryToolActions] = createSignal({
  onRun: () => {}, onInstall: () => {}, onHandoff: () => {},
});
renderSolid(() => RepositoryToolsMenu({
  groups: repositoryToolGroups,
  error: repositoryToolLoadError,
  open: repositoryToolsOpen,
  available: repositoryToolsAvailable,
  disabled: repositoryToolsDisabled,
  onToggle: () => toggleRepositoryTools(),
  ...createRepositoryToolsActionForwarders(repositoryToolActions),
}), document.querySelector('#repo-tools-control'));
const repositoryToolTerminals = new Set();
const repositoryInstallStarted = new Set();
const repositoryInstallTerminalKeys = new Map();
const repositoryToolsController = createRepositoryToolsController({
  invoke, listRepositoryTools, getOwner: repositoryToolsOwner,
  isOpen: repositoryToolsOpen, setOpen: setRepositoryToolsOpen,
  setDisabled: setRepositoryToolsDisabled, setGroups: setRepositoryToolGroups,
  setError: setRepositoryToolLoadError, setActions: setRepositoryToolActions,
  openRepositoryToolTerminal, openWorkbenchShellTerminal,
  launchWorkbenchOsHandoff, installStarted: repositoryInstallStarted,
});
let selectedOwnerRepositoryCount = 0;
const newWork = document.querySelector('#new-work');
const newWorkPrompt = document.querySelector('#new-work-prompt');

function setSessionStatus(message) {
  setSessionStatusMessage(message);
}

const changeReviewController = createChangeReviewController({
  invoke,
  loadChangeReview,
  getSelectedWorkspace: () => selectedWorkspace,
  getSelectedOwnerRepositoryCount: () => selectedOwnerRepositoryCount,
  getSelectedQuickRequest: selectedQuickRequest,
  getRepositoryToolsOwner: repositoryToolsOwner,
  syncRepositoryToolsAvailability,
  docsController,
  setChangeReviewAvailable,
  setChangeReviewSelected,
  setChangeReviewDisabled,
  setChangeReviewVisible,
  setChangeReviewSummary,
  setChangeReviewError,
  setChangeReviewRepositories,
  setChangeReviewMode,
  setDocsButtonSelected,
  setSelectedOwnerVisible,
});
const { showOwnerTerminal, syncChangeReviewAvailability, refreshDocsAvailability, handleChangeReviewClick } = changeReviewController;

function repositoryToolsOwner() {
  if (!selectedWorkspace || selectedQuickRequest()?.quickRequest) return null;
  return { type: 'workspace', id: selectedWorkspace.id };
}

function syncRepositoryToolsAvailability() {
  const available = Boolean(repositoryToolsOwner());
  setRepositoryToolsAvailable(available);
  if (!available) setRepositoryToolsOpen(false);
}

async function attachManagedTerminal(started, owner, tabLabel) {
  let runtime = null;
  try {
    runtime = await terminalRuntime;
    if (appLifetime.disposed) return false;
    if (!runtime) throw new Error('Terminal runtime is unavailable.');
    const terminalId = started.terminalId;
    const ownerKey = `${owner.type}:${owner.id}`;
    const container = document.createElement('div');
    container.className = 'terminal-surface';
    container.id = `terminal-${terminalId}`;
    container.dataset.terminalSession = terminalId;
    Object.entries(terminalAccessibilityAttributes(terminalId)).forEach(([key, value]) => container.setAttribute(key, value));
    terminalViews.append(container);
    sessionOwners.set(terminalId, ownerKey);
    sessionDirectories.set(terminalId, started.directory);
    repositoryToolTerminals.add(terminalId);
    showOwnerTerminal();
    await runtime.attachExisting(terminalId, container, 'repo_tool_terminal');
    if (appLifetime.disposed) return false;
    openSessions.add(terminalId);
    addSessionTab({
      sessionId: terminalId, ownerKey, label: tabLabel, closeable: true, restartable: false,
      onSelect: () => {
        showOwnerTerminal();
        runtime.select(terminalId);
        selectedSessionByOwner.set(ownerKey, terminalId);
        syncOwnerSessions();
      },
      onClose: () => void closeWorkbenchSession(terminalId),
    });
    selectedSessionByOwner.set(ownerKey, terminalId);
    syncOwnerSessions();
    return started;
  } catch (error) {
    if (appLifetime.disposed) return false;
    if (started?.terminalId) {
      try { await repoToolTerminalCommand(invoke, 'cleanup', { terminalId: started.terminalId }); } catch { /* Preserve the startup error; app shutdown remains the final process owner. */ }
      runtime?.forget(started.terminalId);
      document.querySelector(`[data-terminal-session="${CSS.escape(started.terminalId)}"]`)?.remove();
      repositoryToolTerminals.delete(started.terminalId);
      repositoryInstallTerminalKeys.delete(started.terminalId);
      sessionOwners.delete(started.terminalId);
      openSessions.delete(started.terminalId);
    }
    throw error;
  }
}

async function openRepositoryToolTerminal(repository, kind, name = '', installKey = null) {
  const owner = repositoryToolsOwner();
  if (!owner) return false;
  try {
    const started = await startRepositoryTool(invoke, owner.type, owner.id, repository.repositoryId, kind, name);
    if (installKey) repositoryInstallTerminalKeys.set(started.terminalId, installKey);
    return await attachManagedTerminal(started, owner, `${repository.name} · ${started.label}`);
  } catch (error) {
    setSessionStatus(`Could not start ${name || kind}: ${String(error)}`);
    return false;
  }
}

async function openWorkbenchShellTerminal(owner) {
  let started = null;
  try {
    started = await startWorkbenchShell(invoke, owner.type, owner.id);
    return await attachManagedTerminal(started, owner, started.label);
  } catch (error) {
    if (started?.terminalId && !repositoryToolTerminals.has(started.terminalId)) {
      try { await repoToolTerminalCommand(invoke, 'cleanup', { terminalId: started.terminalId }); } catch { /* Keep the visible startup error. */ }
    }
    setSessionStatus(`Could not open terminal: ${String(error)}`);
    return false;
  }
}

const { toggleRepositoryTools } = repositoryToolsController;

function setModelControls(ready) {
  modelsReady = ready;
  syncWorkspaceActionDisabled();
}

let workspaceSessionSubmissionBusy = false;
function syncWorkspaceActionDisabled() {
  const activeWorkspace = Boolean(selectedWorkspace && selectedWorkspace.status === 'active');
  setAttachRepositoryDisabled(!activeWorkspace);
  setWorkspaceSessionSubmitDisabled(!modelsReady || !activeWorkspace || workspaceSessionSubmissionBusy);
}

setModelControls(false);
setProposalModelDisabled(true);

function selectedOwnerKey() {
  if (proposalSessionId && proposalMode()) return 'proposal';
  if (selectedQuickRequest()) return `task:${selectedQuickRequest().id}`;
  if (selectedWorkspace) return `workspace:${selectedWorkspace.id}`;
  return null;
}

function keyForSessionOwner(owner) {
  return owner?.owner_type && owner?.owner_id ? `${owner.owner_type}:${owner.owner_id}` : null;
}

function sessionTabLabel(proposal = false, session = null) {
  if (proposal) return 'Proposal';
  return workspaceSessionTabLabel(
    session,
    navigationData.workspaceSessionContexts,
    window.repositoryCatalog,
  ) || 'OpenCode';
}

function syncPendingPrompt() {
  setPendingPromptVisible(!ownerSetupBusy && Boolean(pendingPromptAction)
    && pendingPromptAction.ownerKey === selectedOwnerKey());
  setPendingPromptDisabled(ownerSetupBusy);
  setPendingPromptLabel(pendingPromptAction?.type === 'quick_request'
    ? 'Start Quick Request' : 'Start workspace session');
}

function syncOwnerControls() {
  const isQuickRequest = Boolean(selectedQuickRequest()?.quickRequest);
  setOwnerIsQuickRequest(isQuickRequest);
}

function syncOwnerSessions() {
  const ownerKey = selectedOwnerKey();
  const hideTabs = Boolean(selectedQuickRequest()?.quickRequest && ownerKey === `task:${selectedQuickRequest().id}`);
  const state = ownerSessionTabState(sessionTabEntries(), ownerKey, selectedSessionByOwner.get(ownerKey), hideTabs);
  const selectedId = state.selectedId;
  if (selectedId) {
    selectedSessionByOwner.set(ownerKey, selectedId);
    void terminalRuntime.then((runtime) => { if (!appLifetime.disposed) runtime?.select(selectedId); });
  }
  setSessionTabEntries(state.entries);
  terminalViews.querySelectorAll('[data-terminal-session]').forEach((view) => {
    const sessionId = view.dataset.terminalSession;
    view.hidden = sessionOwners.get(sessionId) !== ownerKey
      || sessionId !== selectedId;
  });
  return selectedId;
}

async function restoreTrackedOwnerSession(owner) {
  const ownerKey = `${owner.type}:${owner.id}`;
  try {
    await restoreOwnerSessionTabs({
      owner, sessions: navigationData.sessions, selectedSessionByOwner, openSessions,
      repositoryToolTerminals, getTabEntries: sessionTabEntries,
      getSelectedOwnerKey: selectedOwnerKey, showSession,
    });
  } catch (error) {
    if (selectedOwnerKey() === ownerKey) {
      setOwnerStatus( formatWorkspaceError('Restore tracked session', error));
    }
  }
}

const showSession = createKeyedSingleFlight(async (sessionId, options = {}) => {
  const { proposal = false } = options;
  sessionId = resolveSessionReplacement(missingSessionReplacements, sessionId);
  const runtime = await terminalRuntime;
  if (!runtime) throw new Error('Terminal runtime is unavailable; see the startup error above.');
  // Rust resolves the persisted id/directory and owns PTY attachment first;
  // this is intentionally before creating the xterm surface.
  const restoredSession = proposal ? null : await invokeCommand(invoke, 'opencode_session_restore', { sessionId });
  if (appLifetime.disposed) return;
  if (!proposal && restoredSession?.openCodeSessionId !== sessionId) {
    const replacementId = recordSessionReplacement(
      missingSessionReplacements, navigationData, sessionId, restoredSession,
    );
    return showSession(replacementId, options);
  }
  const ownerKey = proposal ? 'proposal' : keyForSessionOwner(restoredSession?.owner);
  const requestOwner = !proposal && restoredSession?.owner?.owner_type === 'task'
    && (selectedQuickRequest()?.id === restoredSession.owner.owner_id && selectedQuickRequest().quickRequest
      || navigationData.tasks?.some((task) => task.id === restoredSession.owner.owner_id && task.quickRequest));
  if (ownerKey) sessionOwners.set(sessionId, ownerKey);
  if (restoredSession?.directory) sessionDirectories.set(sessionId, restoredSession.directory);
  let terminalContainer = document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`);
  if (!openSessions.has(sessionId)) {
    terminalContainer = document.createElement('div');
    terminalContainer.className = 'terminal-surface';
    Object.entries(terminalAccessibilityAttributes(sessionId)).forEach(([name, value]) => terminalContainer.setAttribute(name, value));
    terminalContainer.id = `terminal-${sessionId}`;
    terminalContainer.dataset.terminalSession = sessionId;
    terminalViews.append(terminalContainer);
    await runtime.attachExisting(sessionId, terminalContainer);
    if (appLifetime.disposed) return;
    openSessions.add(sessionId);
    if (!requestOwner) {
      const label = sessionTabLabel(proposal, restoredSession);
      addSessionTab({
        sessionId, ownerKey: ownerKey || '', label, closeable: !proposal,
        restartable: !proposal, restartHidden: !runtime.isExited(sessionId),
        onSelect: () => {
           showOwnerTerminal();
           runtime.select(sessionId);
           selectedSessionByOwner.set(ownerKey, sessionId);
           syncOwnerSessions();
          if (proposal) setSessionStatus('Proposal session · interactive');
          else void refreshSessionEvidence(sessionId);
        },
        onClose: () => void closeWorkbenchSession(sessionId),
        onRestart: () => void restartSessionTerminal(sessionId),
      });
    }
  } else runtime.select(sessionId);
  terminalViews.querySelectorAll('.terminal-surface').forEach((view) => { view.hidden = view !== terminalContainer; });
  if (ownerKey) selectedSessionByOwner.set(ownerKey, sessionId);
  if (proposal) setSessionStatus('Proposal session · interactive');
  else await refreshSessionEvidence(sessionId);
  syncOwnerSessions();
});

async function restartSessionTerminal(sessionId) {
  updateSessionTab(sessionId, { restartBusy: true });
  try {
    const container = document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`);
    const directory = sessionDirectories.get(sessionId);
    if (!container || !directory) throw new Error('The saved session directory is unavailable.');
    const runtime = await terminalRuntime;
    await runtime.restart(sessionId, directory, container);
    updateSessionTab(sessionId, { restartHidden: true });
    await refreshSessionEvidence(sessionId);
  } catch (error) {
    setSessionStatus(`Could not restart terminal: ${String(error)}`);
  } finally {
    updateSessionTab(sessionId, { restartBusy: false });
  }
}

async function refreshSessionEvidence(sessionId) {
  try {
    const [status, pending, reconciliation] = await Promise.all([getSessionStatus(invoke, sessionId), listPendingInputs(invoke, sessionId), reconcileSession(invoke, sessionId)]);
    setSessionStatus(sessionStatusLabel(reconciliation?.status || status));
    setPendingInputMessage('');
    setPendingInputRows([...(pending.permissions || []), ...(pending.forms || [])]
      .map((item) => ({ label: `Input required · ${item.id || item.requestID || 'request'}` })));
  } catch (error) { setSessionStatus(`Session status unavailable: ${String(error)}`); }
}

async function refreshGlobalPendingInputs() {
  try {
    const records = await listAllPendingInputs(invoke);
    if (appNoticeMessage().startsWith('Pending input status unavailable:')) setAppNotice('');
    setPendingInputMessage('');
    setPendingInputRows(records.flatMap((record) => [...(record.permissions || []), ...(record.forms || [])]
      .map((item) => ({ sessionId: record.sessionId, label: `${record.sessionId} · Input required · ${item.id || item.requestID || 'request'}` }))));
  } catch (error) {
    const text = `Pending input status unavailable: ${String(error)}`;
    setPendingInputRows([]);
    setPendingInputMessage(text);
    setAppNotice(text);
  }
}

const workspaceNavigationController = createWorkspaceNavigationController({
  getSelectedWorkspace: () => selectedWorkspace,
  getSelectedQuickRequest: selectedQuickRequest,
  getRepositoryCatalog: () => window.repositoryCatalog,
  setNavigationData: (data) => { navigationData = data; },
  setWorkspaceNavigation,
  setWorkspaceSelected,
  setAttachedRepositoryRows,
  setNavigationBusy,
  setSelectedOwnerRepositoryCount: (count) => { selectedOwnerRepositoryCount = count; },
  syncChangeReviewAvailability,
});
const { renderNavigation, renderAttachedRepositories } = workspaceNavigationController;

// Directories needs initialized destination signals and navigation/Docs actions,
// not placeholders captured before those dependencies exist.
const directoriesController = createDirectoriesController({
  invoke, picker: openDirectoryPicker, getSelectedWorkspace: () => selectedWorkspace,
  getRepositoryCatalog: () => window.repositoryCatalog,
  getNavigationData: () => navigationData,
  setRepositoryCatalog: (repositories) => { window.repositoryCatalog = repositories; },
  refreshNavigation, refreshDocsAvailability, renderAttachedRepositories,
  setters: { setRepositoryStatus, setRepositoryDirectoriesBusy, setDirectoryGroups,
    setRepositoryLibraryPath, repositoryLibraryPath, setRepositoryLibrarySaving,
    setRepositoryLibraryStatus, setLegacyArchives, setLegacyArchivesError,
    setRestoringLegacyArchives, setAttachRepositoryOptions, selectedAttachRepository,
    setSelectedAttachRepository, setOwnerStatus, setFullRequestVisible,
    setDirectoriesVisible, setNoSelectionVisible, setSelectedOwnerVisible,
    setWorkbenchVisible, setRightContentOwnerActive, setQuickRequestTerminalPage,
    setWorkspaceSelected },
});

function selectWorkspace(workspace, data = navigationData) {
  setDirectoriesVisible(false);
  setFullRequestVisible(false);
  setWorkbenchVisible(true);
  setQuickRequestTerminalPage(false);
  setQuickRequestTerminalActionsVisible(false);
  setProposalMode(false);
  setRightContentOwnerActive(true);
  setOwnerStatus( '');
  selectedWorkspace = workspace;
  setSelectedQuickRequest(null);
  setWorkspaceNavigation({ data, selected: workspace });
  selectedOwnerRepositoryCount = (data.workspaceRepositories || []).filter((binding) => binding.workspaceId === workspace.id && binding.verificationStatus === 'verified').length;
  showOwnerTerminal();
  syncChangeReviewAvailability();
  syncRepositoryToolsAvailability();
  syncOwnerControls();
  setNoSelectionVisible(false); setWorkspaceSelected(true); setWorkbenchVisible(true); setSelectedOwnerVisible(true); setNewWorkView('closed');
  setOwnerTitle(workspace.name);
  setOwnerDescription(`${workspace.description || 'Workspace'} · ${workspace.status}`);
  const disabled = workspace.status !== 'active';
  syncWorkspaceActionDisabled();
  setCompleteWorkspaceDisabled(disabled);
  setReactivateWorkspaceDisabled(workspace.status !== 'completed');
  renderNavigation(data);
  syncOwnerSessions();
  syncPendingPrompt();
  void refreshDocsAvailability();
  void restoreTrackedOwnerSession({ type: 'workspace', id: workspace.id });
}

function selectQuickRequest(task, workspace, data = navigationData) {
  if (!task.quickRequest) return;
  setDirectoriesVisible(false);
  setFullRequestVisible(false);
  const isQuickRequest = Boolean(task.quickRequest);
  setWorkbenchVisible(!isQuickRequest);
  setQuickRequestTerminalPage(isQuickRequest);
  setQuickRequestTerminalActionsVisible(isQuickRequest);
  setProposalMode(false);
  setRightContentOwnerActive(true);
  setOwnerStatus( '');
  selectedWorkspace = workspace;
  setSelectedQuickRequest(task);
  setWorkspaceNavigation({ data, selected: null });
  selectedOwnerRepositoryCount = 0;
  showOwnerTerminal();
  syncChangeReviewAvailability();
  syncRepositoryToolsAvailability();
  syncOwnerControls();
  setNoSelectionVisible(false); setWorkspaceSelected(false); setWorkbenchVisible(!isQuickRequest); setSelectedOwnerVisible(true); setNewWorkView('closed');
  setOwnerTitle(task.name);
  setOwnerDescription(`${task.description || 'Quick Request'} · ${task.status}`);
  syncWorkspaceActionDisabled();
  setCompleteWorkspaceDisabled(workspace.status !== 'active');
  setReactivateWorkspaceDisabled(workspace.status !== 'completed');
  renderNavigation(data);
  syncOwnerSessions();
  syncPendingPrompt();
  if (!isQuickRequest) void refreshDocsAvailability();
  void restoreTrackedOwnerSession({ type: 'task', id: task.id });
}
const workspaceLifecycle = createWorkspaceLifecycleController({
  getSelectedWorkspace: () => selectedWorkspace,
  setSelectedWorkspace: (workspace) => { selectedWorkspace = workspace; },
  completeWorkspace, reactivateWorkspace, invoke, setOwnerStatus, refreshNavigation,
  selectWorkspace, getNavigationData: () => navigationData, formatWorkspaceError,
});
const { handleCompleteWorkspace, handleReactivateWorkspace } = workspaceLifecycle;
async function refreshNavigation() { const data = await loadWorkspaceNavigation(invoke); renderNavigation(data); return data; }
const newWorkDialog = document.querySelector('#new-work-dialog');
let requestedNewWorkType = 'workspace';
const newWorkDialogController = createNewWorkDialogController({
  getProposalSessionId: () => proposalSessionId,
  setRequestedType: (value) => { requestedNewWorkType = value; }, setWorkType: setNewWorkType,
  setView: setNewWorkView, setPrompt: setNewWorkPromptValue, setCaptureError: setNewWorkCaptureError,
  dialog: { isOpen: () => newWorkDialog.open, showModal: () => newWorkDialog.showModal(), close: () => newWorkDialog.close() },
  focusPrompt: () => newWorkPrompt.focus(), closeProposalSession,
});
const { open: openNewWork, cancel: cancelNewWork, handleCancelEvent: cancelNewWorkDialog, backToCapture: backToNewWorkCapture } = newWorkDialogController;
renderSolid(() => NewWorkMenu({ onChoose: openNewWork }), document.querySelector('#new-work-menu-root'));
async function renderProposal(proposal, originalPrompt) {
  const review = prepareProposalReview(proposal, originalPrompt, {
    repositoryCatalog: window.repositoryCatalog,
    repositoryLocations: workspaceProposalRepositoryLocations,
  });
  currentProposal = proposal;
  setProposalCreateDisabled(false);
  setProposalRepositoryRows(review.repositoryLocations);
  setProposalView(review);
  setReviewWorkspaceName(review.workspaceName);
  setReviewStartingPrompt(review.startingPrompt);
  if (review.workType === 'quick_request') {
    setQuickRequestDirectories(review.quickRequestDirectories);
    setQuickRequestDirectoryId(review.quickRequestDirectoryId);
    await refreshQuickRequestDirectoryPath();
  }
}

async function refreshQuickRequestDirectoryPath() {
  const requestedRepositoryId = quickRequestDirectoryId() || null;
  setQuickRequestDirectoryPath('Resolving directory…');
  quickRequestDirectoryReady = false;
  setProposalCreateDisabled(true);
  try {
    const resolvedPath = await resolveQuickRequestDirectory(invoke, requestedRepositoryId);
    if ((quickRequestDirectoryId() || null) !== requestedRepositoryId) return;
    setQuickRequestDirectoryPath(resolvedPath);
    quickRequestDirectoryReady = true;
    setProposalCreateDisabled(false);
  } catch (error) {
    if ((quickRequestDirectoryId() || null) !== requestedRepositoryId) return;
    setQuickRequestDirectoryPath(formatWorkspaceError('Resolve Quick Request directory', error));
  }
}
function changeQuickRequestDirectory(event) {
  setQuickRequestDirectoryId(event.currentTarget.value);
  void refreshQuickRequestDirectoryPath();
}
const newWorkProposalController = createNewWorkProposalController({
  getOriginalPrompt: newWorkPromptValue,
  getRequestedType: () => requestedNewWorkType,
  getSelectedModel: proposalSelectedModel,
  getProposalSessionId: () => proposalSessionId,
  setProposalSessionId: (sessionId) => { proposalSessionId = sessionId; },
  invoke, startNewWorkProposal, runNewWorkProposal,
  refreshCatalog,
  clearError: () => setNewWorkCaptureError(''),
  setCaptureError: setNewWorkCaptureError,
  setBusy: setNewWorkCaptureDisabled,
  resetProgress, setProgress, setProposalMode,
  closePriorProposalSession: closeProposalSession,
  renderProposal,
  showReview: () => setNewWorkView('review'),
  formatWorkspaceError,
});
const { handleNewWorkCapture } = newWorkProposalController;
const workspaceCreationController = createWorkspaceCreationController({
  getProposal: () => currentProposal, getProposalSessionId: () => proposalSessionId,
  getSelectedModel: proposalSelectedModel, getStartingPrompt: reviewStartingPrompt,
  getWorkspaceName: reviewWorkspaceName, invoke, createInitializedWorkspace,
  navigationData: () => navigationData, refreshNavigation,
  selectWorkspace, selectCreatedWorkspace, getCatalog: () => window.repositoryCatalog,
  setProgress, setProposalError, setNewWorkView, setProposalView,
  showSession,
  workspaceSetupFailureDetails, hideWorkspaceRepositoryIds, workspaceStartingPromptSession,
  shouldSubmitWorkspaceStartingPrompt, submitNewWorkStartingPrompt,
  setOwnerStatus, clearProposal: () => { currentProposal = null; },
  closeDialog: () => newWorkDialog.close(), closeProposalSession,
  formatWorkspaceError, setOwnerSetupBusy: (value) => { ownerSetupBusy = value; },
  syncPendingPrompt, setCreateDisabled: setProposalCreateDisabled,
  clearError: () => setProposalError(''),
  clearOwnerSetupNotice: () => { ownerSetupNotice = ''; },
  setProposalSessionForProgress: (id) => { progressProposalSessionId = id; },
});
const quickRequestCreationController = createQuickRequestCreationController({
  getProposal: () => currentProposal, modelsReady: () => modelsReady,
  quickRequestDirectoryReady: () => quickRequestDirectoryReady,
  getOriginalPrompt: newWorkPromptValue, getSelectedModel: proposalSelectedModel,
  getRepositoryId: quickRequestDirectoryId, proposalSessionId: () => proposalSessionId,
  invoke, submitResolvedQuickRequestFlow,
  waitForTerminal: async () => {
    if (!await terminalRuntime) throw new Error('Terminal runtime is unavailable.');
  },
  onCreated: (record) => {
    const quickWorkspace = navigationData.workspaces.find((entry) => entry.id === record.task.workspaceId)
      || { id: record.task.workspaceId, name: 'Quick Requests', kind: 'quick_requests', status: 'active' };
    selectQuickRequest(record.task, quickWorkspace, navigationData);
  },
  showSession, refreshRequests: (...args) => refreshRequests(...args),
  setCreateDisabled: setProposalCreateDisabled,
  setOwnerSetupBusy: (value) => { ownerSetupBusy = value; },
  setProposalError, clearOwnerSetupNotice: () => { ownerSetupNotice = ''; },
  setProgressProposalSession: (id) => { progressProposalSessionId = id; },
  setNewWorkView, clearProposal: () => { currentProposal = null; },
  closeDialog: () => newWorkDialog.close(), closeProposalSession,
  setOwnerStatus, formatWorkspaceError, setAppNotice,
  clearPendingPromptAction: () => { pendingPromptAction = null; }, syncPendingPrompt,
});
async function createProposedWork() {
  if (!currentProposal || !modelsReady
    || (currentProposal.workType === 'quick_request' && !quickRequestDirectoryReady)) return;
  if (currentProposal.workType === 'workspace') {
    await workspaceCreationController.createWorkspace();
    return;
  }
  await quickRequestCreationController.createQuickRequest();
}
const submitPendingStartingPrompt = pendingStartingPromptController.submitPendingStartingPrompt;
async function closeProposalSession() {
  const sessionId = proposalSessionId;
  if (!sessionId) return;
  try { await closeNewWorkProposal(invoke, sessionId); }
  catch (error) {
    const message = formatWorkspaceError('Close proposal terminal', error);
    setOwnerStatus( message);
    setCommandResultMessage(message);
    throw error;
  }
  const runtime = await terminalRuntime;
  if (appLifetime.disposed) return;
  runtime?.forget(sessionId);
  document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`)?.remove();
  removeSessionTab(sessionId);
  openSessions.delete(sessionId);
  sessionOwners.delete(sessionId);
  if (selectedSessionByOwner.get('proposal') === sessionId) selectedSessionByOwner.delete('proposal');
  proposalSessionId = null;
  setProposalMode(false);
  syncOwnerSessions();
  syncPendingPrompt();
}

async function closeWorkbenchSession(sessionId) {
  if (sessionId === proposalSessionId) return;
  try {
    if (repositoryToolTerminals.has(sessionId)) {
      await repoToolTerminalCommand(invoke, 'cleanup', { terminalId: sessionId });
    } else {
      await cleanupTerminal(invoke, sessionId);
    }
  } catch (error) {
    const message = formatWorkspaceError('Close terminal', error);
    setOwnerStatus( message);
    setCommandResultMessage(message);
    return;
  }
  const runtime = await terminalRuntime;
  if (appLifetime.disposed) return;
  runtime?.forget(sessionId);
  document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`)?.remove();
  const ownerKey = sessionOwners.get(sessionId);
  removeSessionTab(sessionId);
  openSessions.delete(sessionId);
  sessionOwners.delete(sessionId);
  repositoryToolTerminals.delete(sessionId);
  const installKey = repositoryInstallTerminalKeys.get(sessionId);
  if (installKey) { repositoryInstallStarted.delete(installKey); repositoryInstallTerminalKeys.delete(sessionId); }
  if (selectedSessionByOwner.get(ownerKey) === sessionId) selectedSessionByOwner.delete(ownerKey);
  const selectedId = syncOwnerSessions();
  if (ownerKey === selectedOwnerKey() && !selectedId) {
    setSessionStatus('');
  }
}
async function addRepositoryDirectoriesAction() { return directoriesController.addDirectories(); }
async function refreshCatalog() { return directoriesController.refreshCatalog(); }
async function handleAttachRepository() { return directoriesController.attach(); }
async function refreshDirectories() { return directoriesController.refreshDirectories(); }
async function saveRepositoryLibraryLocation(event) { return directoriesController.saveLibrary(event); }
async function chooseRepositoryLibraryLocation() { return directoriesController.chooseLibrary(); }
async function showDirectoriesPage() { return directoriesController.showPage(); }
async function refreshLegacyTaskArchives() { return directoriesController.refreshArchives(); }
async function restoreLegacyArchiveRecord(archive) { return directoriesController.restoreArchive(archive); }
async function scanSavedRepositoryDirectories() { return directoriesController.scanSavedDirectories(); }
function returnFromDirectories() { return directoriesController.returnFromPage(); }
async function forgetDeletedQuickRequestTerminal(sessionId) {
  const ownerKey = sessionOwners.get(sessionId);
  const runtime = await terminalRuntime;
  if (appLifetime.disposed) return;
  runtime?.forget(sessionId);
  document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`)?.remove();
  removeSessionTab(sessionId);
  openSessions.delete(sessionId);
  sessionOwners.delete(sessionId);
  if (ownerKey && selectedSessionByOwner.get(ownerKey) === sessionId) selectedSessionByOwner.delete(ownerKey);
  syncOwnerSessions();
}
const workspaceSessionForm = createWorkspaceSessionFormController({
  createWorkspaceSession, invoke, getSelectedWorkspace: () => selectedWorkspace,
  isModelsReady: () => modelsReady, getPrompt: workspacePrompt,
  getSelectedModel: quickSelectedModel, showSession, setOwnerStatus, formatWorkspaceError,
  setSubmissionBusy: (busy) => { workspaceSessionSubmissionBusy = busy; },
  syncWorkspaceActionDisabled,
});
const { startWorkspaceSessionFromForm } = workspaceSessionForm;
const quickRequestHistory = createQuickRequestHistoryController({
  invoke, listQuickRequests, restoreQuickRequest, deleteQuickRequest,
  getHistoryQuery: () => historyQuery,
  getNavigationData: () => navigationData,
  getSelectedQuickRequest: selectedQuickRequest,
  selectQuickRequest, showSession, forgetDeletedQuickRequestTerminal,
  confirm: (message) => window.confirm(message), setAppNotice, formatWorkspaceError,
  setRecentQuickRequests, setAllQuickRequests, refreshNavigation,
  clearSelectedRequest: () => {
    setSelectedQuickRequest(null);
    selectedWorkspace = null;
    setQuickRequestTerminalPage(false);
    setQuickRequestTerminalActionsVisible(false);
    setSelectedOwnerVisible(false);
    setNoSelectionVisible(!fullRequestVisible()); setWorkspaceSelected(false);
    setWorkbenchVisible(false);
  },
  showHistoryDestination: () => {
  setDirectoriesVisible(false);
  setFullRequestVisible(true);
  setNoSelectionVisible(false);
  setSelectedOwnerVisible(false);
  setWorkbenchVisible(false);
  setRightContentOwnerActive(false);
  setQuickRequestTerminalPage(false);
  setQuickRequestTerminalActionsVisible(false);
  },
});
const { refreshRequests, openQuickRequestRecord, deleteQuickRequestRecord, showQuickRequestList } = quickRequestHistory;

function returnFromQuickRequest() {
  void showQuickRequestList().catch((error) => setAppNotice(String(error)));
}

quickRequestSubmitHandler = createQuickRequestSubmitHandler({
  view: quickRequestFormView,
  getSelectedModel: quickSelectedModel,
  setErrorMessage: setQuickRequestError,
  invoke,
  isReady: () => modelsReady,
  waitForTerminal: async () => {
    // Do not enable the Rust startup flow until both terminal listeners are
    // registered; otherwise PTY bytes could be lost before xterm mounts.
    const runtime = await terminalRuntime;
    if (!runtime) throw new Error('Terminal runtime is unavailable.');
  },
  showSession,
  refreshRequests,
});

// Launch phase: every root, state binding, and action above is now wired.
// Terminal listener readiness remains independent of model loading; session
// display and explicit creation readiness guards await this promise.
export const terminalRuntime = appLifetime.start({
  loadTerminalRuntime: () => import('./terminal-runtime.js'),
  terminalOptions: {
    invoke,
    listenEvent: listen,
    onExit: ({ sessionId }) => {
      const installKey = repositoryInstallTerminalKeys.get(sessionId);
      if (installKey) { repositoryInstallStarted.delete(installKey); repositoryInstallTerminalKeys.delete(sessionId); }
      updateSessionTab(sessionId, { restartHidden: false });
    },
    onError: ({ sessionId, operation, message }) => {
      const text = `Session ${sessionId} terminal ${operation} failed: ${message}`;
      setSessionStatus(text);
    },
  },
  subscriptions: [
    ['workspace-setup-progress', ({ payload }) => {
      if (!payload || payload.proposalSessionId !== progressProposalSessionId) return;
      const presentation = workspaceProgressPresentation(
        payload,
        currentProposal?.repositories,
        window.repositoryCatalog,
      );
      setProgress(payload.key, presentation.label, payload.status, presentation.detail);
    }],
    ['session-recovery-error', ({ payload }) => {
      const text = `Session recovery failed (${payload?.sessionId || 'unknown'}): ${payload?.message || 'unknown error'}`;
      setAppNotice(text);
      setSessionStatus(text);
    }],
    ['startup-recovery-error', ({ payload }) => {
      setAppNotice(`Startup recovery failed: ${payload?.message || 'unknown error'}`);
    }],
    ['cleanup-recovery-error', ({ payload }) => {
      setAppNotice(showCleanupError('cleanup-recovery-error', payload));
    }],
    ['cleanup-job-error', ({ payload }) => {
      setAppNotice(showCleanupError('cleanup-job-error', payload));
    }],
    ['cleanup-worker-error', ({ payload }) => {
      setAppNotice(showCleanupError('cleanup-worker-error', payload));
    }],
  ],
  poll: () => { void refreshGlobalPendingInputs(); if (openSessions.size) void refreshSessionEvidence([...openSessions][0]); },
}).catch((error) => {
  if (!appLifetime.disposed) {
    console.error(error);
    const message = `Terminal startup failed: ${String(error)}`;
    setSessionStatus(message);
    setTerminalRuntimeStartupFailed(true);
  }
  return null;
});

void loadApplicationShell({ invoke, view: shellView });
void refreshRequests().catch((error) => { setQuickRequestError(String(error)); });
void refreshNavigation().catch((error) => { setQuickRequestError(String(error)); });
void scanSavedRepositoryDirectories().catch((error) => { setOwnerStatus( `Repository scan unavailable: ${String(error)}`); });

void initializeModelSelector({
  invoke,
  view: {
    loading: () => { setQuickModelBusy(true); setQuickModelDisabled(true); },
    ready: (models, defaultModel) => {
      const { options, selected } = modelSelectorChoices(models, defaultModel);
      setQuickModelOptions(options); setQuickSelectedModel(selected); setQuickModelBusy(false); setQuickModelDisabled(false); setQuickModelError('');
      setProposalModels(options); setProposalSelectedModel(selected); setProposalModelDisabled(false); setModelControls(true);
    },
    error: (error) => { setQuickModelOptions([]); setQuickSelectedModel(''); setQuickModelBusy(false); setQuickModelDisabled(true); setQuickModelError(`Models unavailable: ${String(error)}`); },
  },
  onReady: () => { setModelControls(true); },
  onDefaultUnavailable: ({ providerId, id }) => {
    setQuickRequestError(`Configured default model ${providerId}/${id} is unavailable; choose an available model.`);
  },
  onError: (error) => {
    setQuickModelError(`Models unavailable: ${String(error)}`);
    setModelControls(false);
    setQuickRequestError(`Models unavailable: ${String(error)}`);
  },
});

void refreshGlobalPendingInputs();
