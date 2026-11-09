import "@xterm/xterm/css/xterm.css";
import { invokeCommand } from "./services/commandContract.js";
import { withSelectedTicketContext } from "./services/workspaceTicketCommandContext.js";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { open as tauriOpenDirectoryPicker } from "@tauri-apps/plugin-dialog";
import {
  loadApplicationShell,
  loadWorkspaceNavigation,
  createWorkspaceSession,
  startWorkspaceTicketCreation,
  listWorkspaceTickets,
  workOnWorkspaceTicket,
  submitNewWorkStartingPrompt,
  formatWorkspaceError,
  completeWorkspace,
  reactivateWorkspace,
} from "./services/shell.js";
import "./styles.css";
import { cleanupErrorText } from "./lib/errorEvents.js";
import {
  createQuickRequestFormView,
  createQuickRequestSubmitHandler,
} from "./views/quick-requests/quickRequestForm.js";
import { createQuickRequestSelection } from "./views/quick-requests/quickRequestSelection.js";
import { createWorkspaceNavigationController } from "./views/workbench/workspaceNavigationController.js";
import { createPendingStartingPromptController } from "./views/workbench/pendingStartingPromptController.js";
import {
  initializeModelSelector,
  modelSelectorChoices,
} from "./lib/modelSelector.js";
import { loadChangeReview, loadFullDiff } from "./services/changeReviewUi.js";
import { loadPresentationPreferences, saveFileNavigatorWidth, saveChangeReviewMode } from "./services/presentationPreferences.js";
import { createChangeReviewController } from "./views/change-review/changeReviewController.js";
import {
  createRepositoryToolsActionForwarders,
  createRepositoryToolsController,
} from "./views/repository-tools/repositoryToolsController.js";
import { createDocsController } from "./views/docs/docsController.js";
import { createDocsView } from "./views/docs/docsView.js";
import {
  listRepositoryTools,
  launchWorkbenchOsHandoff,
} from "./services/repoToolsUi.js";
import { handleEnterToSubmit } from "./lib/formKeyboard.js";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { createApplicationLifetime } from "./application/applicationLifetime.js";
import { WorkspaceNavigation } from "./views/workbench/WorkspaceNavigation.jsx";
import { WorkspaceTicketViewToggle } from "./views/workbench/WorkspaceTicketViewToggle.jsx";
import { WorkspaceTicketViewer } from "./views/workbench/WorkspaceTicketViewer.jsx";
import { ChangeReviewPanel } from "./views/change-review/ChangeReviewPanel.jsx";
import { DocsPane } from "./views/docs/DocsPane.jsx";
import { RepositoryToolsMenu } from "./views/repository-tools/RepositoryToolsMenu.jsx";
import { WorkspaceOwnerPanel } from "./views/workbench/WorkspaceOwnerPanel.jsx";
import { ApplicationShellStatus } from "./application/ApplicationShellStatus.jsx";
import { createApplicationShellView } from "./application/applicationShellView.js";
import { AppNotice } from "./application/AppNotice.jsx";
import { WorkbenchShell } from "./views/workbench/WorkbenchShell.jsx";
import { NoSelection } from "./application/NoSelection.jsx";
import { RightContentShell } from "./application/RightContentShell.jsx";
import { createWorkspaceLifecycleController } from "./views/workbench/workspaceLifecycleController.js";
import { createWorkspaceSessionFormController } from "./views/workbench/workspaceSessionFormController.js";
import { isBrowserFixture } from "./lib/runtimeMode.js";
import { ApplicationRoot } from "./application/ApplicationRoot.jsx";
import { createNewWork } from "./views/new-work/createNewWork.js";
import { createDirectories } from "./views/directories/createDirectories.js";
import { createQuickRequests } from "./views/quick-requests/createQuickRequests.js";
import { createWorkbenchSessions } from "./views/workbench/createWorkbenchSessions.js";
import { createPortsController } from "./views/ports/portsController.js";
import { PortsPage } from "./views/ports/PortsPage.jsx";
import { PortsNavigationButton } from "./views/ports/PortsNavigationButton.jsx";

const browserFixture = isBrowserFixture(
  import.meta.env.DEV,
  Boolean(window.__TAURI_INTERNALS__),
);
const listen = browserFixture ? async () => () => {} : tauriListen;
const openDirectoryPicker = browserFixture
  ? async () => {
      throw new Error("Browser fixture does not access local directories.");
    }
  : tauriOpenDirectoryPicker;

// Application lifetime and cross-screen composition. Feature-local state and
// actions live in views/; no feature mounts its own Solid root.
const appLifetime = createApplicationLifetime({
  render,
  listen,
  windowTarget: window,
  onError: (error) => {
    console.error(error);
    setAppNotice(
      `Application event subscription/cleanup failed: ${String(error)}`,
    );
  },
});
if (import.meta.hot) import.meta.hot.dispose(() => appLifetime.dispose());
const [rightContentOwnerActive, setRightContentOwnerActive] =
  createSignal(false);
const [quickRequestTerminalPage, setQuickRequestTerminalPage] =
  createSignal(false);
const rightContent = () =>
  RightContentShell({
    ownerActive: rightContentOwnerActive,
    quickRequestTerminalPage,
    quickRequestName: ownerTitle,
    changeReview,
    quickRequestHistory: quickRequests.historyPage,
    directoriesPage: directories.page,
    portsPage: () => PortsPage(ports),
    noSelection,
    ticketViewer: workspaceTicketViewer,
    docsPane,
    workspaceOwnerPanel,
  });

// Command-boundary client.  Raw Tauri invoke is intentionally not available
// in this module or any other production presentation module.
const invoke = (name, payload) => {
  // Pending UI continuations must not issue cleanup/start commands after unload
  // or HMR. Already-running Rust work remains owned by Rust, not this page.
  if (appLifetime.disposed)
    return Promise.reject(
      new Error("Application presentation has been disposed."),
    );
  payload = withSelectedTicketContext(name, payload, selectedTicketFilename());
  return payload === undefined
    ? invokeCommand(name)
    : invokeCommand(name, payload);
};
let quickRequestSubmitHandler;
function handleQuickRequestSubmit(event) {
  return quickRequestSubmitHandler?.(event);
}

// Workspace workbench presentation and the retained Quick Request form adapter.
const [attachedRepositoryRows, setAttachedRepositoryRows] = createSignal([]);
const [ownerTitle, setOwnerTitle] = createSignal("");
const [ownerDescription, setOwnerDescription] = createSignal("");
const [ownerStatus, setOwnerStatus] = createSignal("");
const [sessionStatusMessage, setSessionStatusMessage] = createSignal("");
const [pendingPromptVisible, setPendingPromptVisible] = createSignal(false);
const [pendingPromptDisabled, setPendingPromptDisabled] = createSignal(false);
const [pendingPromptText, setPendingPromptText] = createSignal("");
const [pendingPromptLabel, setPendingPromptLabel] = createSignal(
  "Start workspace session",
);
const pendingStartingPromptController = createPendingStartingPromptController({
  getPendingAction: () => pendingPromptAction,
  getPromptText: pendingPromptText,
  invoke,
  showSession: (...args) => showSession(...args),
  submitStartingPrompt: submitNewWorkStartingPrompt,
  setOwnerStatus,
  formatError: formatWorkspaceError,
  getOwnerSetupNotice: () => ownerSetupNotice,
  clearPendingAction: () => {
    pendingPromptAction = null;
  },
  setPromptVisible: setPendingPromptVisible,
  setPromptText: setPendingPromptText,
  setDisabled: setPendingPromptDisabled,
});
const [ownerIsQuickRequest, setOwnerIsQuickRequest] = createSignal(false);
const [completeWorkspaceDisabled, setCompleteWorkspaceDisabled] =
  createSignal(true);
const [reactivateWorkspaceDisabled, setReactivateWorkspaceDisabled] =
  createSignal(true);
const [attachRepositoryDisabled, setAttachRepositoryDisabled] =
  createSignal(true);
const [attachRepositoryOptions, setAttachRepositoryOptions] = createSignal([]);
const [selectedAttachRepository, setSelectedAttachRepository] =
  createSignal("");
const [workspaceSessionSubmitDisabled, setWorkspaceSessionSubmitDisabled] =
  createSignal(true);
const [workspacePrompt, setWorkspacePrompt] = createSignal("");
const [quickModelOptions, setQuickModelOptions] = createSignal([]);
const [quickSelectedModel, setQuickSelectedModel] = createSignal("");
const [quickModelDisabled, setQuickModelDisabled] = createSignal(true);
const [quickModelBusy, setQuickModelBusy] = createSignal(true);
const [quickModelError, setQuickModelError] = createSignal("");
const [quickRequestError, setQuickRequestError] = createSignal("");
const quickRequestFormView = createQuickRequestFormView();
const [terminalRuntimeStartupFailed, setTerminalRuntimeStartupFailed] =
  createSignal(false);
const [selectedOwnerVisible, setSelectedOwnerVisible] = createSignal(false);
const [proposalMode, setProposalMode] = createSignal(false);
const workspaceOwnerPanel = () =>
  WorkspaceOwnerPanel({
    repositories: attachedRepositoryRows,
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
    onAttachRepositoryChange: (event) =>
      setSelectedAttachRepository(event.currentTarget.value),
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
    onSubmitStartingPrompt: () => submitPendingStartingPrompt(),
    onPendingPromptTextInput: setPendingPromptText,
    onWorkspaceSessionSubmit: (event) => startWorkspaceSessionFromForm(event),
    onEnterToSubmit: handleEnterToSubmit,
    onWorkspacePromptInput: setWorkspacePrompt,
    onCompleteWorkspace: () => handleCompleteWorkspace(),
    onReactivateWorkspace: () => handleReactivateWorkspace(),
    onAttachRepository: handleAttachRepository,
    onQuickRequestSubmit: handleQuickRequestSubmit,
    pendingInputs: sessions.pendingInputs,
    setTerminalViews: sessions.setTerminalViews,
  });

const shellView = createApplicationShellView();
const setCommandResultMessage = shellView.setResult;
const applicationStatus = () =>
  ApplicationShellStatus({ state: shellView.state });
const [appNoticeMessage, setAppNoticeMessage] = createSignal("");
const appNotice = () => AppNotice({ message: appNoticeMessage });
const [directoriesVisible, setDirectoriesVisible] = createSignal(false);
const [portsVisible, setPortsVisible] = createSignal(false);

function setAppNotice(message) {
  setAppNoticeMessage(message);
}

// Shared selection and navigation context. These are presentation snapshots;
// Rust owns the authoritative records, lifecycle and session associations.
let selectedWorkspace = null;
let repositoryCatalog;
const quickRequestSelection = createQuickRequestSelection();
const { selectedQuickRequest, setSelectedQuickRequest } = quickRequestSelection;
let navigationData = {
  workspaces: [],
  tasks: [],
  sessions: [],
  workspaceRepositories: [],
  workspaceSessionContexts: [],
};
const [ticketViewerVisible, setTicketViewerVisible] = createSignal(false);
const [ticketItems, setTicketItems] = createSignal([]);
const [ticketLoading, setTicketLoading] = createSignal(false);
const [ticketWorking, setTicketWorking] = createSignal(false);
const [ticketError, setTicketError] = createSignal("");
const [selectedTicketFilename, setSelectedTicketFilename] = createSignal(null);
const [ticketSessionScope, setTicketSessionScope] = createSignal(null);
const [ticketArchived, setTicketArchived] = createSignal(false);
const [workspaceTicketView, setWorkspaceTicketView] = createSignal("grouped");
async function refreshTicketList(archived = ticketArchived()) {
  const workspaceId = selectedWorkspace?.id;
  if (!workspaceId) return;
  setTicketLoading(true);
  setTicketError("");
  try {
    const tickets = await listWorkspaceTickets(invoke, workspaceId, archived);
    if (selectedWorkspace?.id === workspaceId && ticketArchived() === archived) setTicketItems(tickets);
  } catch (error) {
    setTicketError(String(error));
  } finally {
    setTicketLoading(false);
  }
}
async function workWorkspaceTicket(workspaceId, filename) {
  if (ticketWorking() || !workspaceId) return;
  const workspace = navigationData.workspaces.find(
    (item) => item.id === workspaceId && item.kind === "regular" && item.status === "active",
  );
  if (!workspace) return;
  if (selectedWorkspace?.id !== workspaceId) selectWorkspace(workspace, navigationData);
  setSelectedTicketFilename(filename);
  setTicketWorking(true);
  setTicketError("");
  try {
    const session = await workOnWorkspaceTicket(invoke, workspaceId, filename);
    await refreshNavigation();
    if (selectedWorkspace?.id !== workspaceId || selectedTicketFilename() !== filename) return;
    setTicketSessionScope(filename);
    setTicketViewerVisible(false);
    setWorkbenchVisible(true);
    setSelectedOwnerVisible(true);
    await showSession(session.openCodeSessionId);
  } catch (error) {
    if (selectedWorkspace?.id !== workspaceId || selectedTicketFilename() !== filename) return;
    setTicketViewerVisible(true);
    setWorkbenchVisible(false);
    setTicketError(String(error));
  } finally {
    setTicketWorking(false);
  }
}
const workspaceTicketViewer = () => ticketViewerVisible() && WorkspaceTicketViewer({
  tickets: ticketItems,
  selectedFilename: selectedTicketFilename,
  loading: ticketLoading,
  archived: ticketArchived,
  working: ticketWorking,
  error: ticketError,
  onSelect: (filename) => {
    setSelectedTicketFilename(filename);
    setTicketSessionScope(filename);
    sessions.hide();
    setWorkbenchVisible(Boolean(filename) && !ticketArchived());
    setSelectedOwnerVisible(false);
    syncOwnerSessions({ focus: false });
    syncChangeReviewAvailability();
    syncRepositoryToolsAvailability();
    if (filename && !ticketArchived()) void refreshDocsAvailability();
    else setSelectedOwnerVisible(false);
  },
  onArchiveChange: (archived) => { setTicketArchived(archived); void refreshTicketList(archived); },
  onRefresh: () => void refreshTicketList(),
  onWork: (filename) => workWorkspaceTicket(selectedWorkspace?.id, filename),
  onCreate: async () => {
    const workspaceId = selectedWorkspace?.id;
    try {
      if (!workspaceId) throw new Error("Select a Workspace first.");
      const model = quickSelectedModel();
      if (!model) throw new Error("Choose an enabled OpenCode model before creating a ticket.");
      const session = await startWorkspaceTicketCreation(invoke, workspaceId, JSON.parse(model));
      if (selectedWorkspace?.id !== workspaceId) return;
      setTicketSessionScope("__ticket_creation__");
      setTicketViewerVisible(false);
      setWorkbenchVisible(true);
      setSelectedOwnerVisible(true);
      await refreshNavigation();
      await showSession(session.openCodeSessionId);
    } catch (error) { setTicketViewerVisible(true); setWorkbenchVisible(false); setTicketError(String(error)); }
  },
});
const [fullRequestVisible, setFullRequestVisible] = createSignal(false);
const [workspaceNavigation, setWorkspaceNavigation] = createSignal({
  data: navigationData,
  selected: null,
});
const workspaceViewToggle = () =>
  WorkspaceTicketViewToggle({
    viewMode: workspaceTicketView,
    onToggle: () => setWorkspaceTicketView(workspaceTicketView() === "grouped" ? "flat" : "grouped"),
  });
const [navigationBusy, setNavigationBusy] = createSignal(true);
const workspaceNavigationView = () =>
  WorkspaceNavigation({
    data: () => workspaceNavigation().data,
    selected: () => workspaceNavigation().selected,
    busy: navigationBusy,
    viewMode: workspaceTicketView,
    onSelect: (workspace) => selectWorkspace(workspace, navigationData),
    onWork: (workspace, filename) => workWorkspaceTicket(workspace.id, filename),
    isTicketCurrent: (workspace, ticket) =>
      selectedWorkspace?.id === workspace.id &&
      selectedTicketFilename() === ticket.filename,
  });

function clearActiveNavigationItems() {
  setSelectedQuickRequest(null);
  setSelectedTicketFilename(null);
  setWorkspaceNavigation({ data: navigationData, selected: null });
}
// One page-scoped session presentation, shared by all work destinations.
const sessions = createWorkbenchSessions({
  invoke,
  appLifetime,
  getRuntime: () => terminalRuntime,
  getNavigationData: () => navigationData,
  getCatalog: () => repositoryCatalog,
  selectedOwnerKey,
  selectedQuickRequest,
  proposalSessionId: () => newWork.proposalSessionId(),
  getToolsOwner: repositoryToolsOwner,
  getSessionScope: ticketSessionScope,
  showOwnerTerminal: () => { setTicketViewerVisible(false); showOwnerTerminal(); },
  setOwnerStatus,
  ownerStatus,
  setCommandResultMessage,
  setSessionStatus,
  notice: { get: appNoticeMessage, set: setAppNotice },
});
const {
  showSession,
  restoreTrackedOwnerSession,
  syncOwnerSessions,
  forgetProposalSession,
  forgetDeletedQuickRequestTerminal,
  refreshGlobalPendingInputs,
} = sessions;
let modelsReady = false;
let pendingPromptAction = null;
let ownerSetupNotice = "";
let ownerSetupBusy = false;
const [noSelectionVisible, setNoSelectionVisible] = createSignal(true);
const [workspaceSelected, setWorkspaceSelected] = createSignal(false);
const noSelection = () =>
  NoSelection({ visible: noSelectionVisible, workspaceSelected });
const [workbenchVisible, setWorkbenchVisible] = createSignal(false);
// Workspace-only readers and tools use the same selected owner and terminal host.
const [changeReviewAvailable, setChangeReviewAvailable] = createSignal(false);
const [changeReviewSelected, setChangeReviewSelected] = createSignal(false);
const [changeReviewDisabled, setChangeReviewDisabled] = createSignal(false);
const docsView = createDocsView();
const {
  buttonDisabled: docsDisabled,
  buttonSelected: docsButtonSelected,
  setButtonSelected: setDocsButtonSelected,
} = docsView;
const workbench = () =>
  WorkbenchShell({
    visible: workbenchVisible,
    workspaceName: ownerTitle,
    workspaceRepositoryCount: () =>
      (workspaceNavigation().data.workspaceRepositories || []).filter(
        (binding) =>
          binding.workspaceId === selectedWorkspace?.id &&
          binding.verificationStatus === "verified",
      ).length,
    changeReviewAvailable,
    changeReviewSelected,
    changeReviewDisabled,
    docsDisabled,
    docsButtonSelected,
    onOpenDocs: () => void docsController.open(),
    onOpenChangeReview: (event) => { setTicketViewerVisible(false); void handleChangeReviewClick(event); },
    selectedSessionId: sessions.selectedSessionId,
    sessionTabs: sessions.tabs,
    repositoryTools,
  });
const [changeReviewVisible, setChangeReviewVisible] = createSignal(false);
const [changeReviewLoading, setChangeReviewLoading] = createSignal(false);
const [changeReviewRepositories, setChangeReviewRepositories] = createSignal(
  [],
);
const [changeReviewError, setChangeReviewError] = createSignal("");
const [changeReviewMode, setChangeReviewMode] = createSignal("unified");
const [changeReviewSummary, setChangeReviewSummary] = createSignal("");
const [navigatorWidth, setNavigatorWidth] = createSignal(300);
let navigatorWidthChanged = false;
let changeReviewModeChanged = false;
let preferenceSave = Promise.resolve();
void loadPresentationPreferences(invoke).then((preferences) => {
  if (!navigatorWidthChanged) setNavigatorWidth(preferences.shared.fileNavigator.width);
  if (!changeReviewModeChanged) setChangeReviewMode(preferences.changeReview.mode);
}).catch(() => setAppNotice("Could not load display preferences."));
function savePreference(operation, message) {
  preferenceSave = preferenceSave.catch(() => {}).then(operation).catch(() => setAppNotice(message));
}
function resizeNavigator(width, commit) {
  navigatorWidthChanged = true;
  setNavigatorWidth(width);
  if (commit) {
    savePreference(() => saveFileNavigatorWidth(invoke, width), "Could not save file navigator width.");
  }
}
function selectChangeReviewMode(mode) {
  changeReviewModeChanged = true;
  setChangeReviewMode(mode);
  savePreference(() => saveChangeReviewMode(invoke, mode), "Could not save diff layout.");
}
const changeReview = () =>
  ChangeReviewPanel({
    repositories: changeReviewRepositories,
    visible: changeReviewVisible,
    loading: changeReviewLoading,
    error: changeReviewError,
    mode: changeReviewMode,
    summary: changeReviewSummary,
    navigatorWidth,
    onNavigatorResize: resizeNavigator,
    onMode: selectChangeReviewMode,
    onFullDiff: async (repositoryId, path) => {
      const ownerId = selectedWorkspace?.id;
      if (!ownerId) throw new Error("No workspace selected.");
      const diff = await loadFullDiff(invoke, "workspace", ownerId, repositoryId, path);
      if (selectedWorkspace?.id !== ownerId) throw new Error("Workspace changed while loading context.");
      return diff;
    },
  });
const docsPane = () =>
  DocsPane({
    ...docsView,
    navigatorWidth,
    onNavigatorResize: resizeNavigator,
    onSelect: (file) =>
      void docsController.select(file.path, file.repositoryId),
  });
const docsController = createDocsController({
  invoke,
  getOwner: () =>
    selectedWorkspace && selectedTicketFilename() && !ticketArchived() ? { type: "workspace", id: selectedWorkspace.id } : null,
  view: docsView,
  onOpen: () => {
    setTicketViewerVisible(false);
    changeReviewController.cancelPendingReview();
    setChangeReviewVisible(false);
    setChangeReviewSelected(false);
    setSelectedOwnerVisible(false);
  },
});
const [repositoryToolGroups, setRepositoryToolGroups] = createSignal([]);
const [repositoryToolLoadError, setRepositoryToolLoadError] = createSignal("");
const [repositoryToolsOpen, setRepositoryToolsOpen] = createSignal(false);
const [repositoryToolsAvailable, setRepositoryToolsAvailable] =
  createSignal(false);
const [repositoryToolsDisabled, setRepositoryToolsDisabled] =
  createSignal(false);
const [repositoryToolActions, setRepositoryToolActions] = createSignal({
  onRun: () => {},
  onInstall: () => {},
  onHandoff: () => {},
});
const repositoryTools = () =>
  RepositoryToolsMenu({
    groups: repositoryToolGroups,
    error: repositoryToolLoadError,
    open: repositoryToolsOpen,
    available: repositoryToolsAvailable,
    disabled: repositoryToolsDisabled,
    onToggle: () => toggleRepositoryTools(),
    ...createRepositoryToolsActionForwarders(repositoryToolActions),
  });
const repositoryToolsController = createRepositoryToolsController({
  invoke,
  listRepositoryTools,
  getOwner: repositoryToolsOwner,
  isOpen: repositoryToolsOpen,
  setOpen: setRepositoryToolsOpen,
  setDisabled: setRepositoryToolsDisabled,
  setGroups: setRepositoryToolGroups,
  setError: setRepositoryToolLoadError,
  setActions: setRepositoryToolActions,
  openRepositoryToolTerminal: sessions.openRepositoryToolTerminal,
  openWorkbenchShellTerminal: sessions.openWorkbenchShellTerminal,
  launchWorkbenchOsHandoff,
  installStarted: sessions.installStarted,
});
let selectedOwnerRepositoryCount = 0;

function setSessionStatus(message) {
  setSessionStatusMessage(message);
}

const changeReviewController = createChangeReviewController({
  invoke,
  loadChangeReview,
  getSelectedWorkspace: () => selectedWorkspace,
  getSelectedOwnerRepositoryCount: () => selectedTicketFilename() && !ticketArchived() ? selectedOwnerRepositoryCount : 0,
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
  setChangeReviewLoading,
  setDocsButtonSelected,
  setSelectedOwnerVisible,
});
const {
  showOwnerTerminal,
  syncChangeReviewAvailability,
  refreshDocsAvailability,
  handleChangeReviewClick,
} = changeReviewController;

function repositoryToolsOwner() {
  if (!selectedWorkspace || !selectedTicketFilename() || ticketArchived() || selectedQuickRequest()?.quickRequest) return null;
  return { type: "workspace", id: selectedWorkspace.id };
}

function syncRepositoryToolsAvailability() {
  const available = Boolean(repositoryToolsOwner());
  setRepositoryToolsAvailable(available);
  if (!available) setRepositoryToolsOpen(false);
}

const { toggleRepositoryTools } = repositoryToolsController;

function setModelControls(ready) {
  modelsReady = ready;
  syncWorkspaceActionDisabled();
}

let workspaceSessionSubmissionBusy = false;
function syncWorkspaceActionDisabled() {
  const activeWorkspace = Boolean(
    selectedWorkspace && selectedWorkspace.status === "active",
  );
  setAttachRepositoryDisabled(!activeWorkspace);
  setWorkspaceSessionSubmitDisabled(
    !modelsReady || !activeWorkspace || workspaceSessionSubmissionBusy,
  );
}

setModelControls(false);

function selectedOwnerKey() {
  if (newWork.proposalSessionId() && proposalMode()) return "proposal";
  if (selectedQuickRequest()) return `task:${selectedQuickRequest().id}`;
  if (selectedWorkspace) return `workspace:${selectedWorkspace.id}`;
  return null;
}

function syncPendingPrompt() {
  setPendingPromptVisible(
    !ownerSetupBusy &&
      Boolean(pendingPromptAction) &&
      pendingPromptAction.ownerKey === selectedOwnerKey(),
  );
  setPendingPromptDisabled(ownerSetupBusy);
  setPendingPromptLabel(
    pendingPromptAction?.type === "quick_request"
      ? "Start Quick Request"
      : "Start workspace session",
  );
}

function syncOwnerControls() {
  const isQuickRequest = Boolean(selectedQuickRequest()?.quickRequest);
  setOwnerIsQuickRequest(isQuickRequest);
}

const workspaceNavigationController = createWorkspaceNavigationController({
  getSelectedWorkspace: () => selectedWorkspace,
  getSelectedQuickRequest: selectedQuickRequest,
  getRepositoryCatalog: () => repositoryCatalog,
  setNavigationData: (data) => {
    navigationData = data;
  },
  setWorkspaceNavigation,
  setWorkspaceSelected,
  setAttachedRepositoryRows,
  setNavigationBusy,
  setSelectedOwnerRepositoryCount: (count) => {
    selectedOwnerRepositoryCount = count;
  },
  syncChangeReviewAvailability,
});
const { renderNavigation, renderAttachedRepositories } =
  workspaceNavigationController;

// Directories needs initialized destination signals and navigation/Docs actions,
// not placeholders captured before those dependencies exist.
const directories = createDirectories({
  invoke,
  picker: openDirectoryPicker,
  getSelectedWorkspace: () => selectedWorkspace,
  getRepositoryCatalog: () => repositoryCatalog,
  getNavigationData: () => navigationData,
  setRepositoryCatalog: (repositories) => {
    repositoryCatalog = repositories;
  },
  refreshNavigation,
  refreshDocsAvailability,
  confirm: (message) => window.confirm(message),
  renderAttachedRepositories,
  beforeOpen: () => {
    clearActiveNavigationItems();
    setTicketViewerVisible(false);
    changeReviewController.cancelPendingReview();
    docsController.showTerminal();
    setChangeReviewVisible(false);
  },
  setOwnerStatus,
  attachment: {
    setAttachRepositoryOptions,
    selectedAttachRepository,
    setSelectedAttachRepository,
  },
  destination: {
    visible: directoriesVisible,
    setters: {
      setFullRequestVisible,
      setDirectoriesVisible,
      setPortsVisible,
      setNoSelectionVisible,
      setSelectedOwnerVisible,
      setWorkbenchVisible,
      setRightContentOwnerActive,
      setQuickRequestTerminalPage,
      setWorkspaceSelected,
    },
  },
});

const ports = createPortsController({
  invoke,
  visible: portsVisible,
  setVisible: setPortsVisible,
  onOpen: () => {
    clearActiveNavigationItems();
    setTicketViewerVisible(false);
    changeReviewController.cancelPendingReview();
    docsController.showTerminal();
    setChangeReviewVisible(false);
    setDirectoriesVisible(false);
    setFullRequestVisible(false);
    setNoSelectionVisible(false);
    setSelectedOwnerVisible(false);
    setWorkbenchVisible(false);
    setRightContentOwnerActive(false);
    setQuickRequestTerminalPage(false);
  },
});

function selectWorkspace(workspace, data = navigationData) {
  // Commit the destination first. The browser cannot paint Solid's updates until
  // this click handler returns, so keep the pre-paint path to selection and pane
  // visibility; terminal/repository setup can follow on the next task.
  changeReviewController.cancelPendingReview();
  setDirectoriesVisible(false);
  setPortsVisible(false);
  setFullRequestVisible(false);
  setWorkbenchVisible(false);
  setQuickRequestTerminalPage(false);
  setProposalMode(false);
  setRightContentOwnerActive(true);
  selectedWorkspace = workspace;
  setSelectedQuickRequest(null);
  setSelectedTicketFilename(null);
  setWorkspaceNavigation({ data, selected: workspace });
  setNoSelectionVisible(false);
  setWorkspaceSelected(true);
  setWorkbenchVisible(false);
  setSelectedOwnerVisible(false);
  setTicketArchived(false);
  setSelectedTicketFilename(null);
  setTicketSessionScope(null);
  setTicketViewerVisible(true);
  void refreshTicketList(false);
  newWork.hide();
  setOwnerTitle(workspace.name);
  setOwnerDescription(
    `${workspace.description || "Workspace"} · ${workspace.status}`,
  );
  const disabled = workspace.status !== "active";
  setCompleteWorkspaceDisabled(disabled);
  setReactivateWorkspaceDisabled(workspace.status !== "completed");
  setOwnerStatus("Loading workspace…");
  sessions.hide();
  setTimeout(() => {
    if (selectedWorkspace?.id !== workspace.id || selectedQuickRequest())
      return;
    selectedOwnerRepositoryCount = (data.workspaceRepositories || []).filter(
      (binding) =>
        binding.workspaceId === workspace.id &&
        binding.verificationStatus === "verified",
    ).length;
    syncChangeReviewAvailability();
    syncRepositoryToolsAvailability();
    syncOwnerControls();
    syncWorkspaceActionDisabled();
    renderNavigation(data);
    syncOwnerSessions();
    syncPendingPrompt();
    if (!selectedTicketFilename()) setSelectedOwnerVisible(false);
  }, 0);
}

function selectQuickRequest(task, workspace, data = navigationData, { deferRestore = false } = {}) {
  if (!task.quickRequest) return;
  setTicketViewerVisible(false);
  setDirectoriesVisible(false);
  setPortsVisible(false);
  setFullRequestVisible(false);
  const isQuickRequest = Boolean(task.quickRequest);
  setWorkbenchVisible(!isQuickRequest);
  setQuickRequestTerminalPage(isQuickRequest);
  setProposalMode(false);
  setRightContentOwnerActive(true);
  setOwnerStatus("");
  selectedWorkspace = workspace;
  setSelectedQuickRequest(task);
  setSelectedTicketFilename(null);
  setWorkspaceNavigation({ data, selected: null });
  selectedOwnerRepositoryCount = 0;
  showOwnerTerminal();
  syncChangeReviewAvailability();
  syncRepositoryToolsAvailability();
  syncOwnerControls();
  setNoSelectionVisible(false);
  setWorkspaceSelected(false);
  setWorkbenchVisible(!isQuickRequest);
  setSelectedOwnerVisible(true);
  newWork.hide();
  setOwnerTitle(task.name);
  setOwnerDescription(
    `${task.description || "Quick Request"} · ${task.status}`,
  );
  syncWorkspaceActionDisabled();
  setCompleteWorkspaceDisabled(workspace.status !== "active");
  setReactivateWorkspaceDisabled(workspace.status !== "completed");
  renderNavigation(data);
  syncOwnerSessions();
  syncPendingPrompt();
  if (!isQuickRequest) void refreshDocsAvailability();
  if (!deferRestore) void restoreTrackedOwnerSession({ type: "task", id: task.id });
}
const workspaceLifecycle = createWorkspaceLifecycleController({
  getSelectedWorkspace: () => selectedWorkspace,
  setSelectedWorkspace: (workspace) => {
    selectedWorkspace = workspace;
  },
  completeWorkspace,
  reactivateWorkspace,
  invoke,
  setOwnerStatus,
  refreshNavigation,
  selectWorkspace,
  getNavigationData: () => navigationData,
  formatWorkspaceError,
});
const { handleCompleteWorkspace, handleReactivateWorkspace } =
  workspaceLifecycle;
async function refreshNavigation() {
  const data = await loadWorkspaceNavigation(invoke);
  renderNavigation(data);
  return data;
}
// New Work owns capture/review state; the application connects its outcomes to
// shared navigation and the page-scoped terminal presentation.
const newWork = createNewWork({
  invoke,
  openDirectoryPicker,
  getCatalog: () => repositoryCatalog,
  getNavigationData: () => navigationData,
  refreshCatalog,
  refreshNavigation,
  selectWorkspace,
  selectQuickRequest,
  showSession,
  waitForTerminal: async () => {
    if (!(await terminalRuntime))
      throw new Error("Terminal runtime is unavailable.");
  },
  forgetProposalSession,
  refreshRequests: (...args) => refreshRequests(...args),
  isModelsReady: () => modelsReady,
  owner: {
    setStatus: setOwnerStatus,
    setSetupBusy: (value) => {
      ownerSetupBusy = value;
    },
    clearSetupNotice: () => {
      ownerSetupNotice = "";
    },
    clearPendingPrompt: () => {
      pendingPromptAction = null;
    },
    syncPendingPrompt,
    setProposalMode,
    syncSessions: syncOwnerSessions,
  },
  setCommandResultMessage,
  setAppNotice,
});
const openNewWork = newWork.open;
const submitPendingStartingPrompt =
  pendingStartingPromptController.submitPendingStartingPrompt;
async function refreshCatalog() {
  return directories.refreshCatalog();
}
async function handleAttachRepository() {
  return directories.attach();
}
async function scanSavedRepositoryDirectories() {
  return directories.scanSavedDirectories();
}
const workspaceSessionForm = createWorkspaceSessionFormController({
  createWorkspaceSession,
  invoke,
  getSelectedWorkspace: () => selectedWorkspace,
  isModelsReady: () => modelsReady,
  getPrompt: workspacePrompt,
  getSelectedModel: quickSelectedModel,
  showSession,
  setOwnerStatus,
  formatWorkspaceError,
  setSubmissionBusy: (busy) => {
    workspaceSessionSubmissionBusy = busy;
  },
  syncWorkspaceActionDisabled,
});
const { startWorkspaceSessionFromForm } = workspaceSessionForm;
// Quick Request lists share selection with the dedicated terminal destination.
const quickRequests = createQuickRequests({
  invoke,
  selection: quickRequestSelection,
  getNavigationData: () => navigationData,
  selectQuickRequest,
  showSession,
  forgetDeletedQuickRequestTerminal,
  confirm: (message) => window.confirm(message),
  setAppNotice,
  setOwnerStatus,
  setError: setQuickRequestError,
  refreshNavigation,
  openNewWork,
  destination: {
    visible: fullRequestVisible,
    isQuickRequestVisible: quickRequestTerminalPage,
    clearSelectedRequest: () => {
      setSelectedQuickRequest(null);
      selectedWorkspace = null;
      setQuickRequestTerminalPage(false);
      setSelectedOwnerVisible(false);
      setNoSelectionVisible(!fullRequestVisible());
      setWorkspaceSelected(false);
      setWorkbenchVisible(false);
    },
    showHistory: () => {
      clearActiveNavigationItems();
      setTicketViewerVisible(false);
      changeReviewController.cancelPendingReview();
      docsController.showTerminal();
      setChangeReviewVisible(false);
      setDirectoriesVisible(false);
      setPortsVisible(false);
      setFullRequestVisible(true);
      setNoSelectionVisible(false);
      setSelectedOwnerVisible(false);
      setWorkbenchVisible(false);
      setRightContentOwnerActive(false);
      setQuickRequestTerminalPage(false);
    },
  },
});
const { refreshRequests } = quickRequests;

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
    if (!runtime) throw new Error("Terminal runtime is unavailable.");
  },
  showSession,
  refreshRequests,
});

// Launch phase: the application tree, state bindings, and actions are wired.
// Terminal listener readiness remains independent of model loading; session
// display and explicit creation readiness guards await this promise.
appLifetime.mount(
  () =>
    ApplicationRoot({
      quickRequestHistoryButton: quickRequests.historyButton,
      quickRequestList: quickRequests.recentList,
      workspaceNavigation: workspaceNavigationView,
      workspaceViewToggle,
      directoriesNavigationButton: directories.navigationButton,
      portsNavigationButton: () => PortsNavigationButton({ onOpen: () => void ports.open() }),
      newWorkMenu: newWork.menu,
      workbench,
      rightContent,
      applicationStatus,
      appNotice,
      newWorkDialog: newWork.dialog,
    }),
  document.getElementById("app-root"),
);
export const terminalRuntime = appLifetime
  .start({
    loadTerminalRuntime: () => import("./terminal/terminalRuntime.js"),
    terminalOptions: {
      invoke,
      listenEvent: listen,
      onExit: sessions.onExit,
      onError: ({ sessionId, operation, message }) => {
        const text = `Session ${sessionId} terminal ${operation} failed: ${message}`;
        setSessionStatus(text);
      },
    },
    subscriptions: [
      [
        "workspace-tickets-changed",
        () => {
          void refreshNavigation().catch((error) =>
            setAppNotice(`Workspace ticket refresh failed: ${error}`),
          );
        },
      ],
      [
        "workspace-setup-progress",
        ({ payload }) => {
          newWork.onSetupProgress(payload);
        },
      ],
      [
        "session-recovery-error",
        ({ payload }) => {
          const text = `Session recovery failed (${payload?.sessionId || "unknown"}): ${payload?.message || "unknown error"}`;
          setAppNotice(text);
          setSessionStatus(text);
        },
      ],
      [
        "startup-recovery-error",
        ({ payload }) => {
          setAppNotice(
            `Startup recovery failed: ${payload?.message || "unknown error"}`,
          );
        },
      ],
      [
        "cleanup-recovery-error",
        ({ payload }) => {
          setAppNotice(cleanupErrorText("cleanup-recovery-error", payload));
        },
      ],
      [
        "cleanup-job-error",
        ({ payload }) => {
          setAppNotice(cleanupErrorText("cleanup-job-error", payload));
        },
      ],
      [
        "cleanup-worker-error",
        ({ payload }) => {
          setAppNotice(cleanupErrorText("cleanup-worker-error", payload));
        },
      ],
    ],
    poll: sessions.poll,
  })
  .catch((error) => {
    if (!appLifetime.disposed) {
      console.error(error);
      const message = `Terminal startup failed: ${String(error)}`;
      setSessionStatus(message);
      setTerminalRuntimeStartupFailed(true);
    }
    return null;
  });

void loadApplicationShell({ invoke, view: shellView });
void refreshRequests().catch((error) => {
  setQuickRequestError(String(error));
});
void refreshNavigation().catch((error) => {
  setQuickRequestError(String(error));
});
void scanSavedRepositoryDirectories().catch((error) => {
  setOwnerStatus(`Repository scan unavailable: ${String(error)}`);
});

void initializeModelSelector({
  invoke,
  view: {
    loading: () => {
      setQuickModelBusy(true);
      setQuickModelDisabled(true);
    },
    ready: (models, defaultModel) => {
      const { options, selected } = modelSelectorChoices(models, defaultModel);
      setQuickModelOptions(options);
      setQuickSelectedModel(selected);
      setQuickModelBusy(false);
      setQuickModelDisabled(false);
      setQuickModelError("");
      newWork.setModels(options, selected);
      setModelControls(true);
    },
    error: (error) => {
      setQuickModelOptions([]);
      setQuickSelectedModel("");
      setQuickModelBusy(false);
      setQuickModelDisabled(true);
      setQuickModelError(`Models unavailable: ${String(error)}`);
    },
  },
  onReady: () => {
    setModelControls(true);
  },
  onDefaultUnavailable: ({ providerId, id }) => {
    setQuickRequestError(
      `Configured default model ${providerId}/${id} is unavailable; choose an available model.`,
    );
  },
  onError: (error) => {
    setQuickModelError(`Models unavailable: ${String(error)}`);
    setModelControls(false);
    setQuickRequestError(`Models unavailable: ${String(error)}`);
  },
});

void refreshGlobalPendingInputs();
