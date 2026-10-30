import { createSignal } from "solid-js";
import { NewWorkDialog } from "./NewWorkDialog.jsx";
import { NewWorkMenu } from "./NewWorkMenu.jsx";
import { ProposalRepositoryList } from "./ProposalRepositoryList.jsx";
import { createNewWorkDialogController } from "./newWorkDialogController.js";
import { createNewWorkProposalController } from "./newWorkProposalController.js";
import { createWorkspaceCreationController } from "./workspaceCreationController.js";
import { createQuickRequestCreationController } from "./quickRequestCreationController.js";
import { createNewWorkProposalPreview } from "./newWorkProposalPreview.js";
import { prepareProposalReview } from "./newWorkProposalReview.js";
import { handleEnterToSubmit } from "../../lib/formKeyboard.js";
import {
  hideWorkspaceRepositoryIds,
  workspaceProgressPresentation,
  workspaceSetupFailureDetails,
} from "./workspaceSetupProgress.js";
import {
  startNewWorkProposal,
  previewNewWorkProposal,
  runNewWorkProposal,
  closeNewWorkProposal,
  createInitializedWorkspace,
  selectCreatedWorkspace,
  workspaceProposalRepositoryLocations,
  workspaceStartingPromptSession,
  shouldSubmitWorkspaceStartingPrompt,
  submitNewWorkStartingPrompt,
  resolveQuickRequestDirectory,
  submitResolvedQuickRequestFlow,
  formatWorkspaceError,
} from "../../services/shell.js";

// Owns the transient capture → review → creation presentation. Product records,
// validation, provisioning and process ownership still live behind Rust commands.
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
  const [reviewWorkspaceName, setReviewWorkspaceName] = createSignal("");
  const [reviewStartingPrompt, setReviewStartingPrompt] = createSignal("");
  const [progressVisible, setProgressVisible] = createSignal(false);
  const [progressRows, setProgressRows] = createSignal(new Map());
  const [newWorkCaptureError, setNewWorkCaptureError] = createSignal("");
  const [proposalError, setProposalError] = createSignal("");
  const [proposalCreateDisabled, setProposalCreateDisabled] =
    createSignal(true);
  const [proposalModelDisabled, setProposalModelDisabled] = createSignal(true);
  const [proposalModels, setProposalModels] = createSignal([]);
  const [proposalSelectedModel, setProposalSelectedModel] = createSignal("");
  const [newWorkCaptureDisabled, setNewWorkCaptureDisabled] =
    createSignal(false);
  const [newWorkPromptValue, setNewWorkPromptValue] = createSignal("");
  const [preview, setPreview] = createSignal("");
  const proposalPreview = createNewWorkProposalPreview({
    requestPreview: () => previewNewWorkProposal(invoke),
    setPreview,
  });
  const [proposalRepositoryRows, setProposalRepositoryRows] = createSignal([]);
  let newWorkDialog;
  let newWorkPrompt;
  let requestedNewWorkType = "workspace";
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

  const dialogController = createNewWorkDialogController({
    getProposalSessionId: () => proposalSessionId,
    setRequestedType: (value) => {
      requestedNewWorkType = value;
    },
    setWorkType: setNewWorkType,
    setView: setNewWorkView,
    setPrompt: setNewWorkPromptValue,
    setCaptureError: setNewWorkCaptureError,
    dialog: {
      isOpen: () => newWorkDialog.open,
      showModal: () => newWorkDialog.showModal(),
      close: () => newWorkDialog.close(),
    },
    focusPrompt: () => newWorkPrompt.focus(),
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
      repositoryLocations: workspaceProposalRepositoryLocations,
    });
    currentProposal = proposal;
    setProposalCreateDisabled(false);
    setProposalRepositoryRows(review.repositoryLocations);
    setProposalView(review);
    setReviewWorkspaceName(review.workspaceName);
    setReviewStartingPrompt(review.startingPrompt);
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
    getRequestedType: () => requestedNewWorkType,
    getExplicitDirectory: () => requestedNewWorkType === "quick_request" && customQuickDirectory() !== null ? customQuickDirectory() : undefined,
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
    getProposal: () => currentProposal,
    getProposalSessionId: () => proposalSessionId,
    getSelectedModel: proposalSelectedModel,
    getStartingPrompt: reviewStartingPrompt,
    getWorkspaceName: reviewWorkspaceName,
    invoke,
    createInitializedWorkspace,
    navigationData: getNavigationData,
    refreshNavigation,
    selectWorkspace,
    selectCreatedWorkspace,
    getCatalog,
    setProgress,
    setProposalError,
    setNewWorkView,
    setProposalView,
    showSession,
    workspaceSetupFailureDetails,
    hideWorkspaceRepositoryIds,
    workspaceStartingPromptSession,
    shouldSubmitWorkspaceStartingPrompt,
    submitNewWorkStartingPrompt,
    setOwnerStatus: owner.setStatus,
    clearProposal: () => {
      currentProposal = null;
    },
    closeDialog: () => newWorkDialog.close(),
    closeProposalSession,
    formatWorkspaceError,
    setOwnerSetupBusy: owner.setSetupBusy,
    syncPendingPrompt: owner.syncPendingPrompt,
    setCreateDisabled: setProposalCreateDisabled,
    clearError: () => setProposalError(""),
    clearOwnerSetupNotice: owner.clearSetupNotice,
    setProposalSessionForProgress: (id) => {
      progressProposalSessionId = id;
    },
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
    closeDialog: () => newWorkDialog.close(),
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
      !isModelsReady() ||
      (currentProposal.workType === "quick_request" &&
        !quickRequestDirectoryReady)
    )
      return;
    if (currentProposal.workType === "workspace") {
      await workspaceCreation.createWorkspace();
      return;
    }
    await quickRequestCreation.createQuickRequest();
  }

  function openNewWork(type) {
      setCustomQuickDirectory(null);
      setDefaultQuickDirectory("");
      if (type === "quick_request") {
        void resolveQuickRequestDirectory(invoke).then(setDefaultQuickDirectory)
          .catch((error) => setDefaultQuickDirectory(formatWorkspaceError("Resolve Quick Request directory", error)));
      }
      const disclosure = newWorkDialog.querySelector("#proposal-prompt-preview");
      if (disclosure) disclosure.open = false;
      proposalPreview.close();
      return dialogController.open(type);
  }
  async function cancelNewWork() {
    await dialogController.cancel();
    if (!newWorkDialog.open) proposalPreview.close();
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
        currentProposal?.repositories,
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
    dialog: () =>
      NewWorkDialog({
        setDialog: (element) => {
          newWorkDialog = element;
        },
        setPromptElement: (element) => {
          newWorkPrompt = element;
        },
        proposalRepositories: () =>
          ProposalRepositoryList({ repositories: proposalRepositoryRows }),
        proposal: proposalView,
        workspaceName: reviewWorkspaceName,
        setWorkspaceName: setReviewWorkspaceName,
        startingPrompt: reviewStartingPrompt,
        setStartingPrompt: setReviewStartingPrompt,
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
        preview,
        onPreviewToggle: (event) => {
          if (event.currentTarget.open) proposalPreview.open();
          else proposalPreview.close();
        },
        onCapture: proposalController.handleNewWorkCapture,
        onEnterToSubmit: handleEnterToSubmit,
        onBack: dialogController.backToCapture,
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
