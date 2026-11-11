import { createSignal } from "solid-js";
import { NewWorkModal } from "./modal/NewWorkModal.jsx";
import { NewWorkMenu } from "./NewWorkMenu.jsx";
import { createNewWorkModalController } from "./modal/newWorkModalController.js";
import { createNewWorkProposalController } from "./modal/newWorkProposalController.js";
import { createWorkspaceCreationController } from "./modal/workspaceCreationController.js";
import { EMPTY_WORKSPACE_REPOSITORY } from "./modal/workspaceCreationController.js";
import { createQuickRequestCreationController } from "./modal/quickRequestCreationController.js";
import { workspaceTitleFromRepositoryName } from "./modal/workspaceTitle.js";
import { prepareProposalReview } from "./modal/newWorkProposalReview.js";
import { handleEnterToSubmit } from "../../lib/formKeyboard.js";
import { workspaceProgressPresentation } from "./modal/workspaceSetupProgress.js";
import {
  startNewWorkProposal,
  runNewWorkProposal,
  closeNewWorkProposal,
  createWorkspace,
  selectCreatedWorkspace,
  resolveQuickRequestDirectory,
  submitResolvedQuickRequestFlow,
  formatWorkspaceError,
} from "../../services/shell.js";

// Composes direct Workspace creation with the separate Quick Request proposal flow.
export function createNewWork({
  invoke,
  openDirectoryPicker,
  getCatalog,
  getNavigationData,
  refreshCatalog,
  refreshNavigation,
  selectWorkspace,
  selectQuickRequest,
  showSession,
  waitForTerminal,
  forgetProposalSession,
  refreshRequests,
  isModelsReady,
  owner,
  setCommandResultMessage,
  setAppNotice,
}) {
  const [newWorkView, setNewWorkView] = createSignal("closed");
  const [newWorkType, setNewWorkType] = createSignal("workspace");
  const [quickRequestDirectories, setQuickRequestDirectories] = createSignal(
    [],
  );
  const [quickRequestDirectoryId, setQuickRequestDirectoryId] =
    createSignal("");
  const [quickRequestDirectoryPath, setQuickRequestDirectoryPath] =
    createSignal("");
  const [customQuickDirectory, setCustomQuickDirectory] = createSignal(null);
  const [defaultQuickDirectory, setDefaultQuickDirectory] = createSignal("");
  const [proposalView, setProposalView] = createSignal({
    workType: "workspace",
    title: "Check the proposed context",
    workspaceName: "",
    workspaceDirectory: "",
    originalPrompt: "",
    startingPrompt: "",
    createLabel: "Create",
  });
  const [progressVisible, setProgressVisible] = createSignal(false);
  const [progressRows, setProgressRows] = createSignal(new Map());
  const [newWorkCaptureError, setNewWorkCaptureError] = createSignal("");
  const [proposalError, setProposalError] = createSignal("");
  const [workspaceError, setWorkspaceError] = createSignal("");
  const [workspaceRepositoryChoice, setWorkspaceRepositoryChoice] = createSignal("");
  const [workspaceName, setWorkspaceName] = createSignal("");
  const [workspaceDescription, setWorkspaceDescription] = createSignal("");
  const [workspaceCatalogLoading, setWorkspaceCatalogLoading] = createSignal(false);
  const [workspaceRepositories, setWorkspaceRepositories] = createSignal([]);
  const [proposalCreateDisabled, setProposalCreateDisabled] =
    createSignal(true);
  const [proposalModelDisabled, setProposalModelDisabled] = createSignal(true);
  const [proposalModels, setProposalModels] = createSignal([]);
  const [proposalSelectedModel, setProposalSelectedModel] = createSignal("");
  const [newWorkCaptureDisabled, setNewWorkCaptureDisabled] =
    createSignal(false);
  const [newWorkPromptValue, setNewWorkPromptValue] = createSignal("");
  let newWorkModal;
  let newWorkPrompt;
  let currentProposal = null;
  let quickRequestDirectoryReady = false;
  let proposalSessionId = null;
  let progressProposalSessionId = null;

  function resetProgress(sessionId = null) {
    progressProposalSessionId = sessionId;
    setProgressRows(new Map());
    setProgressVisible(true);
  }

  function setProgress(key, label, status, detail = null) {
    setProgressRows((rows) =>
      new Map(rows).set(key, { label, status, detail }),
    );
  }

  async function closeProposalSession() {
    const sessionId = proposalSessionId;
    if (!sessionId) return;
    try {
      await closeNewWorkProposal(invoke, sessionId);
    } catch (error) {
      const message = formatWorkspaceError("Close proposal terminal", error);
      owner.setStatus(message);
      setCommandResultMessage(message);
      throw error;
    }
    if (!(await forgetProposalSession(sessionId))) return;
    proposalSessionId = null;
    owner.setProposalMode(false);
    owner.syncSessions();
    owner.syncPendingPrompt();
  }

  const modalController = createNewWorkModalController({
    getProposalSessionId: () => proposalSessionId,
    setWorkType: setNewWorkType,
    setView: setNewWorkView,
    setPrompt: setNewWorkPromptValue,
    setCaptureError: setNewWorkCaptureError,
    resetWorkspaceFields: () => {
      setWorkspaceRepositoryChoice("");
      setWorkspaceName("");
      setWorkspaceDescription("");
      setWorkspaceError("");
    },
    modal: {
      isOpen: () => newWorkModal.open,
      showModal: () => newWorkModal.showModal(),
      close: () => newWorkModal.close(),
    },
    focusPrompt: () => newWorkPrompt.focus(),
    focusWorkspace: () =>
      newWorkModal.querySelector("#workspace-repository-select")?.focus(),
    closeProposalSession,
  });

  async function refreshQuickRequestDirectoryPath() {
    const requestedRepositoryId = quickRequestDirectoryId() || null;
    setQuickRequestDirectoryPath("Resolving directory…");
    quickRequestDirectoryReady = false;
    setProposalCreateDisabled(true);
    try {
      const resolvedPath = await resolveQuickRequestDirectory(
        invoke,
        requestedRepositoryId,
      );
      if ((quickRequestDirectoryId() || null) !== requestedRepositoryId) return;
      setQuickRequestDirectoryPath(resolvedPath);
      quickRequestDirectoryReady = true;
      setProposalCreateDisabled(false);
    } catch (error) {
      if ((quickRequestDirectoryId() || null) !== requestedRepositoryId) return;
      setQuickRequestDirectoryPath(
        formatWorkspaceError("Resolve Quick Request directory", error),
      );
    }
  }

  async function renderProposal(proposal, originalPrompt) {
    const review = prepareProposalReview(proposal, originalPrompt, {
      repositoryCatalog: getCatalog(),
    });
    currentProposal = proposal;
    setProposalCreateDisabled(false);
    setProposalView(review);
    if (review.workType === "quick_request") {
      setQuickRequestDirectories(review.quickRequestDirectories);
      setQuickRequestDirectoryId(review.quickRequestDirectoryId);
      if (customQuickDirectory()) {
        setQuickRequestDirectoryPath(customQuickDirectory());
        quickRequestDirectoryReady = true;
      } else await refreshQuickRequestDirectoryPath();
    }
  }

  const proposalController = createNewWorkProposalController({
    getOriginalPrompt: newWorkPromptValue,
    getExplicitDirectory: () =>
      customQuickDirectory() !== null ? customQuickDirectory() : undefined,
    getSelectedModel: proposalSelectedModel,
    getProposalSessionId: () => proposalSessionId,
    setProposalSessionId: (id) => {
      proposalSessionId = id;
    },
    invoke,
    startNewWorkProposal,
    runNewWorkProposal,
    refreshCatalog,
    clearError: () => setNewWorkCaptureError(""),
    setCaptureError: setNewWorkCaptureError,
    setBusy: setNewWorkCaptureDisabled,
    resetProgress,
    setProgress,
    setProposalMode: owner.setProposalMode,
    closePriorProposalSession: closeProposalSession,
    renderProposal,
    showReview: () => setNewWorkView("review"),
    formatWorkspaceError,
  });

  const workspaceCreation = createWorkspaceCreationController({
    getRepositoryChoice: workspaceRepositoryChoice,
    getWorkspaceName: workspaceName,
    getWorkspaceDescription: workspaceDescription,
    invoke,
    createWorkspace,
    navigationData: getNavigationData,
    refreshNavigation,
    selectWorkspace,
    selectCreatedWorkspace,
    setBusy: setNewWorkCaptureDisabled,
    setError: setWorkspaceError,
    setNotice: setAppNotice,
    setView: setNewWorkView,
    closeModal: () => newWorkModal.close(),
    formatWorkspaceError,
  });

  const quickRequestCreation = createQuickRequestCreationController({
    getProposal: () => currentProposal,
    modelsReady: isModelsReady,
    quickRequestDirectoryReady: () => quickRequestDirectoryReady,
    getOriginalPrompt: newWorkPromptValue,
    getSelectedModel: proposalSelectedModel,
    getRepositoryId: () => customQuickDirectory() === defaultQuickDirectory() ? null : quickRequestDirectoryId(),
    getDirectory: () => customQuickDirectory() === defaultQuickDirectory() ? null : customQuickDirectory(),
    proposalSessionId: () => proposalSessionId,
    invoke,
    submitResolvedQuickRequestFlow,
    waitForTerminal,
    onCreated: (record) => {
      const data = getNavigationData();
      const workspace = data.workspaces.find(
        (entry) => entry.id === record.task.workspaceId,
      ) || {
        id: record.task.workspaceId,
        name: "Quick Requests",
        kind: "quick_requests",
        status: "active",
      };
      selectQuickRequest(record.task, workspace, data);
    },
    showSession,
    refreshRequests,
    setCreateDisabled: setProposalCreateDisabled,
    setOwnerSetupBusy: owner.setSetupBusy,
    setProposalError,
    clearOwnerSetupNotice: owner.clearSetupNotice,
    setProgressProposalSession: (id) => {
      progressProposalSessionId = id;
    },
    setNewWorkView,
    clearProposal: () => {
      currentProposal = null;
    },
    closeModal: () => newWorkModal.close(),
    closeProposalSession,
    setOwnerStatus: owner.setStatus,
    formatWorkspaceError,
    setAppNotice,
    clearPendingPromptAction: owner.clearPendingPrompt,
    syncPendingPrompt: owner.syncPendingPrompt,
  });

  async function createProposedWork() {
    if (
      !currentProposal ||
      currentProposal.workType !== "quick_request" ||
      !isModelsReady() ||
      !quickRequestDirectoryReady
    ) return;
    await quickRequestCreation.createQuickRequest();
  }

  function openNewWork(type) {
    setCustomQuickDirectory(null);
    setDefaultQuickDirectory("");
    if (type === "quick_request") {
      void resolveQuickRequestDirectory(invoke)
        .then(setDefaultQuickDirectory)
        .catch((error) =>
          setDefaultQuickDirectory(
            formatWorkspaceError("Resolve Quick Request directory", error),
          ),
        );
    } else if (type === "workspace") {
      setWorkspaceRepositories(getCatalog() || []);
      setWorkspaceCatalogLoading(true);
      void refreshCatalog()
        .then((repositories) => setWorkspaceRepositories(repositories))
        .catch((error) => {
          setWorkspaceError(formatWorkspaceError("Load repositories", error));
        })
        .finally(() => setWorkspaceCatalogLoading(false));
    }
    return modalController.open(type);
  }
  async function cancelNewWork() {
    await modalController.cancel();
  }
  return {
    open: openNewWork,
    hide: () => setNewWorkView("closed"),
    proposalSessionId: () => proposalSessionId,
    setModels(options, selected) {
      setProposalModels(options);
      setProposalSelectedModel(selected);
      setProposalModelDisabled(false);
    },
    onSetupProgress(payload) {
      if (!payload || payload.proposalSessionId !== progressProposalSessionId)
        return;
        const presentation = workspaceProgressPresentation(
          payload,
          [],
          getCatalog(),
      );
      setProgress(
        payload.key,
        presentation.label,
        payload.status,
        presentation.detail,
      );
    },
    menu: () => NewWorkMenu({ onChoose: openNewWork }),
    modal: () =>
      NewWorkModal({
        setModal: (element) => {
          newWorkModal = element;
        },
        setPromptElement: (element) => {
          newWorkPrompt = element;
        },
        proposal: proposalView,
        workspaceVisible: () => newWorkView() === "workspace",
        workspaceRepositoryChoice,
        workspaceRepositories,
        workspaceCatalogLoading,
        workspaceEmptySelected: () =>
          workspaceRepositoryChoice() === EMPTY_WORKSPACE_REPOSITORY,
        emptyWorkspaceChoice: EMPTY_WORKSPACE_REPOSITORY,
        onWorkspaceRepositoryChange: (repositoryId) => {
          setWorkspaceRepositoryChoice(repositoryId);
          const repository = workspaceRepositories().find(
            (item) => item.id === repositoryId,
          );
          if (repository)
            setWorkspaceName(workspaceTitleFromRepositoryName(repository.name));
          else if (repositoryId === EMPTY_WORKSPACE_REPOSITORY)
            setWorkspaceName("");
          setWorkspaceError("");
        },
        workspaceName,
        setWorkspaceName,
        workspaceDescription,
        setWorkspaceDescription,
        workspaceError,
        workspaceCreateDisabled: () =>
          newWorkCaptureDisabled() ||
          workspaceCatalogLoading() ||
          !workspaceRepositoryChoice(),
        onWorkspaceSubmit: workspaceCreation.create,
        workType: newWorkType,
        captureVisible: () => newWorkView() === "capture",
        reviewVisible: () => newWorkView() === "review",
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
        onCapture: proposalController.handleNewWorkCapture,
        onEnterToSubmit: handleEnterToSubmit,
        onBack: modalController.backToCapture,
        onCancel: cancelNewWork,
        onConfirm: createProposedWork,
        onDirectoryChange: (event) => {
          setCustomQuickDirectory(null);
          setQuickRequestDirectoryId(event.currentTarget.value);
          void refreshQuickRequestDirectoryPath();
        },
        directories: quickRequestDirectories,
        directoryId: quickRequestDirectoryId,
        directoryPath: quickRequestDirectoryPath,
        defaultDirectory: defaultQuickDirectory,
        customDirectory: customQuickDirectory,
        onCustomDirectoryInput: (value) => {
          setCustomQuickDirectory(value);
          if (newWorkView() === "review") {
            setQuickRequestDirectoryPath(value);
            quickRequestDirectoryReady = Boolean(value.trim());
            setProposalCreateDisabled(!quickRequestDirectoryReady);
          }
        },
        onChooseDirectory: async () => {
          try {
            const selected = await openDirectoryPicker({ directory: true, multiple: false, title: "Choose working directory" });
            if (selected) {
              setCustomQuickDirectory(selected);
              setQuickRequestDirectoryPath(selected);
              quickRequestDirectoryReady = true;
              setProposalCreateDisabled(false);
            }
          } catch (error) { setNewWorkCaptureError(formatWorkspaceError("Choose working directory", error)); }
        },
        onResetDirectory: () => {
          setCustomQuickDirectory(defaultQuickDirectory());
          setQuickRequestDirectoryId("");
          setQuickRequestDirectoryPath(defaultQuickDirectory());
          quickRequestDirectoryReady = Boolean(defaultQuickDirectory());
          setProposalCreateDisabled(!quickRequestDirectoryReady);
        },
      }),
  };
}
