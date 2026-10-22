import '@xterm/xterm/css/xterm.css';
import { invokeCommand } from './command-contract.js';
import { listen } from '@tauri-apps/api/event';
import { open as openDirectoryPicker } from '@tauri-apps/plugin-dialog';
import { loadApplicationShell } from './shell.js';
import { listQuickRequests, restoreQuickRequest, deleteQuickRequest, loadWorkspaceNavigation, createInitializedWorkspace, createWorkspaceTask, submitNewWorkStartingPrompt, shouldSubmitWorkspaceStartingPrompt, getTaskSetupStatus, taskSetupStatusNotice, cancelTaskSetup, resumeTaskSetup, retryTaskSetup, addRepositoryDirectories, scanRepositories, listRepositoryCatalog, loadRepositoryDirectoryPage, setRepositoryEnabled, attachRepository, createWorkspaceSession, formatWorkspaceError, workspaceNavigationModel, selectCreatedWorkspace, listPendingInputs, listAllPendingInputs, getSessionStatus, reconcileSession, createTaskSession, sessionStatusLabel, completeTask, listTaskCleanupJobs, retryTaskCleanup, completeWorkspace, reactivateWorkspace, sessionTabAttributes, terminalAccessibilityAttributes, controlErrorAttributes, startNewWorkProposal, runNewWorkProposal, closeNewWorkProposal, cleanupTerminal, resolveQuickRequestDirectory, submitResolvedQuickRequestFlow, createKeyedSingleFlight, workspaceProposalRepositoryLocations, workspaceStartingPrompt, workspaceReviewDetails, taskWorkspaceOptions } from './shell.js';
import './styles.css';
import { clearNoticeIfStartsWith, showCleanupError } from './error-events.js';
import { bindQuickRequestForm } from './quick-request-form.js';
import { initializeModelSelector } from './model-selector.js';
import { createWorkspaceNavigationButton, populateTaskWorkspaceSelector } from './task-workspace-ui.js';
import { recordSessionReplacement, resolveSessionReplacement } from './session-restore-ui.js';
import { loadChangeReview, renderChangeReview } from './change-review-ui.js';
import { listRepositoryTools, renderRepositoryTools, startRepositoryTool, repoToolTerminalCommand } from './repo-tools-ui.js';
import { groupRepositoryDirectories } from './directory-groups.js';
import { bindEnterToSubmit } from './form-keyboard.js';

// Command-boundary client.  Raw Tauri invoke is intentionally not available
// in this module or any other production presentation module.
const invoke = (name, payload) => payload === undefined
  ? invokeCommand(name)
  : invokeCommand(name, payload);

const connectionStatus = document.querySelector('#connection-status');
const connectionIndicator = document.querySelector('#connection-indicator');
const commandResult = document.querySelector('#command-result');
const appVersion = document.querySelector('#app-version');
const appNotice = document.querySelector('#app-notice');

void loadApplicationShell({
  invoke,
  connectionStatus,
  connectionIndicator,
  commandResult,
  appVersion,
});

// Listener registration is deliberately independent of session creation. A
// later workflow may enable controls only after this promise resolves.
export const terminalRuntime = import('./terminal-runtime.js')
  .then(({ TerminalRuntime }) => new TerminalRuntime({
    invoke,
    onExit: ({ sessionId }) => {
      const installKey = repositoryInstallTerminalKeys.get(sessionId);
      if (installKey) { repositoryInstallStarted.delete(installKey); repositoryInstallTerminalKeys.delete(sessionId); }
      const restart = sessionTabs?.querySelector(`[data-restart-session="${CSS.escape(sessionId)}"]`);
      if (restart) restart.hidden = false;
    },
    onError: ({ sessionId, operation, message }) => {
      const text = `Session ${sessionId} terminal ${operation} failed: ${message}`;
      setSessionStatus(text);
    },
  }).start())
  .catch((error) => {
    console.error(error);
    const message = `Terminal startup failed: ${String(error)}`;
    setSessionStatus(message);
    document.querySelectorAll('button').forEach((button) => {
      if (button.closest('#quick-request-form, #workspace-session-form, #new-task-session')) button.disabled = true;
    });
    return null;
  });

function setAppNotice(message) {
  if (!appNotice) return;
  appNotice.textContent = message;
  appNotice.hidden = !message;
}

function resetProgress(sessionId = null) {
  progressProposalSessionId = sessionId;
  progressRows.clear();
  progressSteps.replaceChildren();
  newWorkPrompt.after(progressPanel);
  progressPanel.hidden = false;
}

function setProgress(key, label, status, detail = null) {
  let row = progressRows.get(key);
  if (!row) {
    row = { item: document.createElement('li'), text: document.createElement('span'), detail: document.createElement('details') };
    row.detail.append(Object.assign(document.createElement('summary'), { textContent: 'Details' }), document.createElement('pre'));
    row.item.append(row.text, row.detail);
    progressRows.set(key, row);
    progressSteps.append(row.item);
  }
  const displayStatus = status === 'running' ? 'in progress' : status === 'skipped' ? 'not run' : status;
  row.text.textContent = `${label} — ${displayStatus}`;
  row.item.dataset.status = status;
  row.detail.hidden = !detail;
  if (detail) row.detail.querySelector('pre').textContent = detail;
}

void listen('workspace-setup-progress', ({ payload }) => {
  if (!payload || payload.proposalSessionId !== progressProposalSessionId) return;
  const repositoryId = /^(?:clone|session):(.+)$/.exec(payload.key || '')?.[1];
  const repository = currentProposal?.repositories?.find((item) => item.repositoryId === repositoryId);
  const label = repository && payload.key.startsWith('clone:')
    ? `Clone ${repository.name}`
    : repository && payload.key.startsWith('session:')
      ? `Start ${repository.name} terminal` : payload.label;
  setProgress(payload.key, label, payload.status, payload.detail);
});

void listen('session-recovery-error', ({ payload }) => {
  const text = `Session recovery failed (${payload?.sessionId || 'unknown'}): ${payload?.message || 'unknown error'}`;
  setAppNotice(text);
  setSessionStatus(text);
});
void listen('startup-recovery-error', ({ payload }) => {
  setAppNotice(`Startup recovery failed: ${payload?.message || 'unknown error'}`);
});
void listen('cleanup-recovery-error', ({ payload }) => {
  setAppNotice(showCleanupError('cleanup-recovery-error', payload));
});
void listen('cleanup-job-error', ({ payload }) => {
  setAppNotice(showCleanupError('cleanup-job-error', payload));
});
void listen('cleanup-worker-error', ({ payload }) => {
  setAppNotice(showCleanupError('cleanup-worker-error', payload));
});

const form = document.querySelector('#quick-request-form');
const prompt = document.querySelector('#quick-prompt');
const model = document.querySelector('#quick-model');
const submit = document.querySelector('#quick-submit');
const errorMessage = document.querySelector('#quick-error');
const list = document.querySelector('#quick-request-list');
const fullRequestList = document.querySelector('#quick-request-full-items');
const fullRequestDestination = document.querySelector('#quick-request-full-list');
const fullRequestSearch = document.querySelector('#quick-request-search');
const terminalViews = document.querySelector('#terminal-views');
const workspaceList = document.querySelector('#workspace-list');
const workspaceContextMenu = document.querySelector('#workspace-context-menu');
const taskWorkspaceField = document.querySelector('#task-workspace-field');
const taskWorkspaceSelect = document.querySelector('#task-workspace-select');
const workspaceTitle = document.querySelector('#selected-title');
const workspaceDescription = document.querySelector('#workspace-description');
const workspaceStatus = document.querySelector('#workspace-status');
const sessionStatus = document.querySelector('#session-status');
const pendingInputs = document.querySelector('#pending-inputs');
let selectedWorkspace = null;
let selectedTask = null;
let navigationData = { workspaces: [], tasks: [], sessions: [], workspaceRepositories: [] };
const sessionTabs = document.querySelector('#session-tabs');
const openSessions = new Set();
const sessionOwners = new Map();
const selectedSessionByOwner = new Map();
const sessionDirectories = new Map();
const missingSessionReplacements = new Map();
const progressPanel = document.querySelector('#new-work-progress');
const progressSteps = document.querySelector('#new-work-progress-steps');
const progressRows = new Map();
let modelsReady = false;
let currentProposal = null;
let quickRequestDirectoryReady = false;
let proposalSessionId = null;
let progressProposalSessionId = null;
let pendingPromptAction = null;
let ownerSetupNotice = '';
let ownerSetupBusy = false;
let newWorkWorkspaceContext = null;
let contextMenuWorkspace = null;
let contextMenuTrigger = null;
let currentTaskSetupNotice = null;
const noSelection = document.querySelector('#no-selection');
const workbench = document.querySelector('#workbench');
const selectedOwner = document.querySelector('#selected-owner');
const changeReviewPage = document.querySelector('#change-review-page');
const changeReviewButton = document.querySelector('#show-change-review');
const repoToolsButton = document.querySelector('#show-repo-tools');
const repoToolsMenu = document.querySelector('#repo-tools-menu');
const repositoryToolTerminals = new Set();
const repositoryInstallStarted = new Set();
const repositoryInstallTerminalKeys = new Map();
let selectedOwnerRepositoryCount = 0;
const newWork = document.querySelector('#new-work');
const newWorkReview = document.querySelector('#new-work-review');
const newWorkPrompt = document.querySelector('#new-work-prompt');
const proposalCreate = document.querySelector('#proposal-create');
const proposalModel = document.querySelector('#proposal-model');
bindEnterToSubmit(document.querySelector('#new-work-capture'));
bindEnterToSubmit(document.querySelector('#workspace-session-form'));

function setSessionStatus(message) {
  if (!sessionStatus) return;
  sessionStatus.textContent = message;
  sessionStatus.hidden = !message;
}

function showOwnerTerminal() {
  changeReviewPage.hidden = true;
  selectedOwner.hidden = false;
  changeReviewButton.classList.remove('selected');
}

function syncChangeReviewAvailability() {
  const available = Boolean(selectedWorkspace && selectedOwnerRepositoryCount > 0 && !selectedTask?.quickRequest);
  changeReviewButton.hidden = !available;
  if (!available) showOwnerTerminal();
  syncRepositoryToolsAvailability();
}

changeReviewButton.addEventListener('click', async () => {
  if (!selectedWorkspace || !selectedOwnerRepositoryCount) return;
  const ownerType = selectedTask ? 'task' : 'workspace';
  const ownerId = selectedTask?.id || selectedWorkspace.id;
  changeReviewButton.disabled = true;
  changeReviewButton.classList.add('selected');
  selectedOwner.hidden = true;
  changeReviewPage.hidden = false;
  changeReviewPage.querySelector('[data-review-title]').textContent = 'Loading changes…';
  try {
    const repositories = await loadChangeReview(invoke, ownerType, ownerId);
    if ((selectedTask?.id || selectedWorkspace?.id) !== ownerId) return;
    renderChangeReview(changeReviewPage, repositories);
  } catch (error) {
    changeReviewPage.querySelector('[data-review-title]').textContent = `Could not load changes: ${String(error)}`;
    changeReviewPage.querySelector('[data-review-files]').replaceChildren();
    changeReviewPage.querySelector('[data-review-diff]').replaceChildren();
  } finally { changeReviewButton.disabled = false; }
});
document.querySelector('#change-review-back').addEventListener('click', showOwnerTerminal);

function repositoryToolsOwner() {
  if (!selectedWorkspace || selectedTask?.quickRequest) return null;
  return selectedTask
    ? { type: 'task', id: selectedTask.id }
    : { type: 'workspace', id: selectedWorkspace.id };
}

function syncRepositoryToolsAvailability() {
  repoToolsButton.hidden = !repositoryToolsOwner() || selectedOwnerRepositoryCount === 0;
  if (repoToolsButton.hidden) {
    repoToolsMenu.hidden = true;
    repoToolsButton.setAttribute('aria-expanded', 'false');
  }
}

async function openRepositoryToolTerminal(repository, kind, name = '', installKey = null) {
  const owner = repositoryToolsOwner();
  if (!owner) return;
  let started = null;
  let runtime = null;
  try {
    started = await startRepositoryTool(invoke, owner.type, owner.id, repository.repositoryId, kind, name);
    if (installKey) repositoryInstallTerminalKeys.set(started.terminalId, installKey);
    runtime = await terminalRuntime;
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
    openSessions.add(terminalId);
    const item = document.createElement('div'); item.className = 'session-tab-item'; item.setAttribute('role', 'presentation');
    const tab = document.createElement('button'); tab.type = 'button'; tab.dataset.sessionId = terminalId; tab.dataset.ownerKey = ownerKey;
    tab.textContent = `${repository.name} · ${started.label}`;
    Object.entries(sessionTabAttributes(terminalId, true)).forEach(([key, value]) => tab.setAttribute(key, value));
    tab.addEventListener('click', () => { showOwnerTerminal(); runtime.select(terminalId); syncOwnerSessions(); });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'session-tab-close'; close.textContent = '×'; close.setAttribute('aria-label', `Close ${tab.textContent}`);
    close.addEventListener('click', () => void closeWorkbenchSession(terminalId));
    item.append(tab, close); sessionTabs.append(item);
    sessionTabs.querySelectorAll(`[data-owner-key="${CSS.escape(ownerKey)}"]`).forEach((entry) => entry.classList.toggle('selected', entry === tab));
    selectedSessionByOwner.set(ownerKey, terminalId);
    syncOwnerSessions();
    return started;
  } catch (error) {
    if (started?.terminalId) {
      try { await repoToolTerminalCommand(invoke, 'cleanup', { terminalId: started.terminalId }); } catch { /* Preserve the startup error; app shutdown remains the final process owner. */ }
      runtime?.forget(started.terminalId);
      document.querySelector(`[data-terminal-session="${CSS.escape(started.terminalId)}"]`)?.remove();
      repositoryToolTerminals.delete(started.terminalId);
      sessionOwners.delete(started.terminalId);
      openSessions.delete(started.terminalId);
    }
    setSessionStatus(`Could not start ${name || kind}: ${String(error)}`);
    return false;
  }
}

repoToolsButton.addEventListener('click', async () => {
  if (!repoToolsMenu.hidden) {
    repoToolsMenu.hidden = true;
    repoToolsButton.setAttribute('aria-expanded', 'false');
    return;
  }
  const owner = repositoryToolsOwner();
  if (!owner) return;
  repoToolsButton.disabled = true;
  try {
    const groups = await listRepositoryTools(invoke, owner.type, owner.id);
    if (repositoryToolsOwner()?.id !== owner.id) return;
    renderRepositoryTools(repoToolsMenu, groups, {
      onRun: (repository, kind, name) => void openRepositoryToolTerminal(repository, kind, name),
      onInstall: async (repository, button, status) => {
        button.hidden = true;
        const key = `${owner.type}:${owner.id}:${repository.repositoryId}:${repository.path}`;
        if (repositoryInstallStarted.has(key)) { status.textContent = 'npm install is already running.'; return; }
        repositoryInstallStarted.add(key);
        status.textContent = 'Starting npm install…';
        const started = await openRepositoryToolTerminal(repository, 'npm_install', '', key);
        if (!started) repositoryInstallStarted.delete(key);
        status.textContent = started ? 'npm install opened in an interactive terminal.' : 'Could not start npm install; see the terminal error.';
      },
    });
    repoToolsMenu.hidden = false;
    repoToolsButton.setAttribute('aria-expanded', 'true');
  } catch (error) {
    repoToolsMenu.replaceChildren(Object.assign(document.createElement('p'), { textContent: `Could not load tools: ${String(error)}` }));
    repoToolsMenu.hidden = false;
  } finally { repoToolsButton.disabled = false; }
});

function setModelControls(ready) {
  modelsReady = ready;
  model.disabled = !ready;
  submit.disabled = !ready;
  document.querySelector('#workspace-session-submit').disabled = !ready || !selectedWorkspace || selectedWorkspace.status !== 'active';
  model.setAttribute('aria-busy', String(!ready));
}

setModelControls(false);
proposalModel.disabled = true;

function selectedOwnerKey() {
  if (proposalSessionId && selectedOwner.classList.contains('proposal-mode')) return 'proposal';
  if (selectedTask) return `task:${selectedTask.id}`;
  if (selectedWorkspace) return `workspace:${selectedWorkspace.id}`;
  return null;
}

function keyForSessionOwner(owner) {
  return owner?.owner_type && owner?.owner_id ? `${owner.owner_type}:${owner.owner_id}` : null;
}

function sessionTabLabel(proposal = false, session = null) {
  if (proposal) return 'Proposal';
  if (session?.owner?.owner_type === 'workspace') {
    const binding = (navigationData.workspaceRepositories || []).find((item) =>
      item.workspaceId === session.owner.owner_id && item.checkoutPath === session.directory);
    if (binding) {
      const repository = (window.repositoryCatalog || []).find((item) => item.id === binding.repositoryId);
      return repository?.name || binding.repositoryId;
    }
  }
  return 'OpenCode';
}

function syncPendingPrompt() {
  const section = document.querySelector('#pending-starting-prompt');
  if (!section) return;
  const startButton = document.querySelector('#submit-starting-prompt');
  section.hidden = ownerSetupBusy || !pendingPromptAction || pendingPromptAction.ownerKey !== selectedOwnerKey();
  startButton.disabled = ownerSetupBusy;
  startButton.textContent = pendingPromptAction?.type === 'task'
    ? 'Start task setup'
    : pendingPromptAction?.type === 'quick_request' ? 'Start Quick Request' : 'Start workspace session';
}

function syncOwnerControls() {
  const isTask = Boolean(selectedTask);
  const isRegularTask = isTask && !selectedTask.quickRequest;
  document.querySelector('#workspace-session-form').hidden = isTask;
  document.querySelector('#attach-repository').hidden = isTask;
  for (const id of ['task-setup-cancel', 'task-setup-resume', 'task-setup-refresh', 'new-task-session', 'complete-task', 'retry-cleanup']) {
    document.querySelector(`#${id}`).hidden = !isRegularTask;
  }
  for (const id of ['complete-workspace', 'reactivate-workspace']) {
    document.querySelector(`#${id}`).hidden = isTask;
  }
}

function syncOwnerSessions() {
  const ownerKey = selectedOwnerKey();
  const ownerTabs = [...sessionTabs.querySelectorAll('[data-session-id]')]
    .filter((tab) => tab.dataset.ownerKey === ownerKey);
  if (selectedTask?.quickRequest && ownerKey === `task:${selectedTask.id}`) {
    const selectedId = selectedSessionByOwner.get(ownerKey);
    if (selectedId) void terminalRuntime.then((runtime) => runtime?.select(selectedId));
    sessionTabs.querySelectorAll('[data-session-id]').forEach((tab) => {
      tab.hidden = true;
      if (tab.parentElement?.classList.contains('session-tab-item')) tab.parentElement.hidden = true;
    });
    terminalViews.querySelectorAll('[data-terminal-session]').forEach((view) => {
      view.hidden = sessionOwners.get(view.dataset.terminalSession) !== ownerKey
        || view.dataset.terminalSession !== selectedId;
    });
    return;
  }
  const selectedTab = ownerTabs.find((tab) => tab.classList.contains('selected'))
    || ownerTabs.find((tab) => tab.dataset.sessionId === selectedSessionByOwner.get(ownerKey))
    || ownerTabs[0];
  if (selectedTab) {
    ownerTabs.forEach((tab) => {
      const selected = tab === selectedTab;
      tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    });
    selectedSessionByOwner.set(ownerKey, selectedTab.dataset.sessionId);
    void terminalRuntime.then((runtime) => runtime?.select(selectedTab.dataset.sessionId));
  }
  sessionTabs.querySelectorAll('[data-session-id]').forEach((tab) => {
    tab.hidden = tab.dataset.ownerKey !== ownerKey;
    if (tab.parentElement?.classList.contains('session-tab-item')) {
      tab.parentElement.hidden = tab.hidden;
    }
  });
  terminalViews.querySelectorAll('[data-terminal-session]').forEach((view) => {
    const sessionId = view.dataset.terminalSession;
    view.hidden = sessionOwners.get(sessionId) !== ownerKey
      || sessionId !== selectedTab?.dataset.sessionId;
  });
}

async function restoreTrackedOwnerSession(owner) {
  const ownerKey = `${owner.type}:${owner.id}`;
  const preferredToolTerminal = selectedSessionByOwner.get(ownerKey);
  const sessions = (navigationData.sessions || []).filter((session) =>
    session.owner?.owner_type === owner.type && session.owner?.owner_id === owner.id
      && session.lastKnownStatus !== 'missing');
  if (!sessions.length || selectedOwnerKey() !== ownerKey) return;
  const preferred = sessions.find((session) => session.openCodeSessionId === selectedSessionByOwner.get(ownerKey))
    || sessions.find((session) => openSessions.has(session.openCodeSessionId))
    || sessions[0];
  try {
    for (const session of sessions) await showSession(session.openCodeSessionId);
    if (preferredToolTerminal && repositoryToolTerminals.has(preferredToolTerminal)) {
      sessionTabs.querySelector(`[data-session-id="${CSS.escape(preferredToolTerminal)}"]`)?.click();
    } else {
      await showSession(preferred.openCodeSessionId);
    }
  } catch (error) {
    if (selectedOwnerKey() === ownerKey) {
      workspaceStatus.textContent = formatWorkspaceError('Restore tracked session', error);
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
  if (!proposal && restoredSession?.openCodeSessionId !== sessionId) {
    const replacementId = recordSessionReplacement(
      missingSessionReplacements, navigationData, sessionId, restoredSession,
    );
    return showSession(replacementId, options);
  }
  const ownerKey = proposal ? 'proposal' : keyForSessionOwner(restoredSession?.owner);
  const requestOwner = !proposal && restoredSession?.owner?.owner_type === 'task'
    && (selectedTask?.id === restoredSession.owner.owner_id && selectedTask.quickRequest
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
    openSessions.add(sessionId);
    if (!requestOwner) {
      const tab = document.createElement('button');
      tab.type = 'button'; tab.dataset.sessionId = sessionId; tab.dataset.ownerKey = ownerKey || ''; tab.textContent = sessionTabLabel(proposal, restoredSession);
      Object.entries(sessionTabAttributes(sessionId, true)).forEach(([name, value]) => tab.setAttribute(name, value));
      tab.setAttribute('aria-label', `Open ${tab.textContent}`);
     tab.setAttribute('aria-selected', 'true');
      tab.addEventListener('click', () => {
        showOwnerTerminal();
        runtime.select(sessionId);
        selectedSessionByOwner.set(ownerKey, sessionId);
        sessionTabs.querySelectorAll(`[data-owner-key="${CSS.escape(ownerKey || '')}"]`).forEach((entry) => {
          entry.classList.toggle('selected', entry.dataset.sessionId === sessionId);
          entry.setAttribute('aria-selected', String(entry.dataset.sessionId === sessionId));
        });
        syncOwnerSessions();
        if (proposal) setSessionStatus('Proposal session · interactive');
        else void refreshSessionEvidence(sessionId);
      });
    const tabItem = document.createElement('div');
    tabItem.className = 'session-tab-item';
    tabItem.setAttribute('role', 'presentation');
      const close = document.createElement('button');
    close.type = 'button';
    close.className = 'session-tab-close';
    close.textContent = '×';
    close.setAttribute('aria-label', `Close ${tab.textContent}`);
      close.addEventListener('click', () => void closeWorkbenchSession(sessionId));
      const restart = document.createElement('button');
      restart.type = 'button';
      restart.className = 'session-tab-restart';
      restart.textContent = 'Restart';
      restart.dataset.restartSession = sessionId;
      restart.setAttribute('aria-label', `Restart terminal for ${tab.textContent}`);
      restart.hidden = !runtime.isExited(sessionId);
      restart.addEventListener('click', () => void restartSessionTerminal(sessionId, restart));
      tabItem.append(tab);
      if (!proposal) tabItem.append(restart);
      if (!proposal) tabItem.append(close);
      sessionTabs.append(tabItem);
    }
  } else runtime.select(sessionId);
  terminalViews.querySelectorAll('.terminal-surface').forEach((view) => { view.hidden = view !== terminalContainer; });
   sessionTabs.querySelectorAll(`[data-owner-key="${CSS.escape(ownerKey || '')}"]`).forEach((tab) => {
     const selected = tab.dataset.sessionId === sessionId;
     tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
   });
  if (ownerKey) selectedSessionByOwner.set(ownerKey, sessionId);
  if (proposal) setSessionStatus('Proposal session · interactive');
  else await refreshSessionEvidence(sessionId);
  syncOwnerSessions();
});

async function restartSessionTerminal(sessionId, button) {
  button.disabled = true;
  try {
    const container = document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`);
    const directory = sessionDirectories.get(sessionId);
    if (!container || !directory) throw new Error('The saved session directory is unavailable.');
    const runtime = await terminalRuntime;
    await runtime.restart(sessionId, directory, container);
    button.hidden = true;
    await refreshSessionEvidence(sessionId);
  } catch (error) {
    setSessionStatus(`Could not restart terminal: ${String(error)}`);
  } finally {
    button.disabled = false;
  }
}

sessionTabs.addEventListener('keydown', (event) => {
  const tabs = [...sessionTabs.querySelectorAll('[role="tab"]')].filter((tab) => !tab.hidden);
  if (!tabs.length || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const current = Math.max(0, tabs.indexOf(document.activeElement));
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
});

async function refreshSessionEvidence(sessionId) {
  try {
    const [status, pending, reconciliation] = await Promise.all([getSessionStatus(invoke, sessionId), listPendingInputs(invoke, sessionId), reconcileSession(invoke, sessionId)]);
    setSessionStatus(sessionStatusLabel(reconciliation?.status || status));
    pendingInputs.replaceChildren(...[...(pending.permissions || []), ...(pending.forms || [])].map((item) => Object.assign(document.createElement('li'), { textContent: `Input required · ${item.id || item.requestID || 'request'}` })));
  } catch (error) { setSessionStatus(`Session status unavailable: ${String(error)}`); }
}

async function refreshGlobalPendingInputs() {
  try {
    const records = await listAllPendingInputs(invoke);
    clearNoticeIfStartsWith(appNotice, 'Pending input status unavailable:');
    pendingInputs.replaceChildren(...records.flatMap((record) => [...(record.permissions || []), ...(record.forms || [])].map((item) => {
      const entry = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${record.sessionId} · Input required · ${item.id || item.requestID || 'request'}`;
      button.addEventListener('click', () => { showOwnerTerminal(); void showSession(record.sessionId); }); entry.append(button); return entry;
    })));
  } catch (error) {
    const text = `Pending input status unavailable: ${String(error)}`;
    pendingInputs.textContent = text;
    setAppNotice(text);
  }
}

function renderNavigation(data) {
  navigationData = data;
  if (selectedWorkspace && !selectedTask) {
    selectedOwnerRepositoryCount = (data.workspaceRepositories || []).filter((binding) =>
      binding.workspaceId === selectedWorkspace.id && binding.verificationStatus === 'verified').length;
    syncChangeReviewAvailability();
  }
  document.querySelector('#workspaces-unselected').hidden = Boolean(selectedWorkspace);
  const ownerTabs = document.querySelector('#owner-tabs');
  if (ownerTabs) {
    const activeWorkspace = data.workspaces?.find((workspace) => workspace.id === selectedWorkspace?.id);
    const selectedTasks = activeWorkspace
      ? (data.tasks || []).filter((task) => task.workspaceId === activeWorkspace.id && task.status === 'active')
      : [];
    const entries = activeWorkspace?.kind === 'regular'
      ? [{ owner: activeWorkspace, workspace: activeWorkspace }, ...selectedTasks.map((task) => ({ owner: task, workspace: activeWorkspace }))]
      : selectedTask?.quickRequest ? [{ owner: selectedTask, workspace: activeWorkspace }] : [];
    ownerTabs.replaceChildren(...entries.map(({ owner, workspace }) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = owner === workspace ? workspace.name : owner.name;
      button.className = (selectedTask?.id === owner.id || (!selectedTask && selectedWorkspace?.id === owner.id)) ? 'selected' : '';
      button.addEventListener('click', () => owner === workspace ? selectWorkspace(workspace, data) : selectTask(owner, workspace, data));
      return button;
    }));
  }
  workspaceList.setAttribute('aria-busy', 'false');
  const regular = workspaceNavigationModel(data).filter(({ workspace }) => workspace.status === 'active');
  const renderTasks = ({ workspace, tasks }) => tasks.filter((task) => task.status === 'active').map((task) => {
    const taskItem = document.createElement('li');
    taskItem.className = `nested-task ${task.status}`;
    const taskButton = document.createElement('button');
    taskButton.type = 'button';
    taskButton.className = selectedTask?.id === task.id ? 'selected' : '';
    taskButton.textContent = `${task.name} · ${task.status}`;
    taskButton.addEventListener('click', () => selectTask(task, workspace, data));
    taskItem.append(taskButton);
    return taskItem;
  });
  const renderWorkspace = ({ workspace, tasks }) => {
     const item = document.createElement('li');
     const repositoryCount = (data.workspaceRepositories || []).filter((binding) =>
       binding.workspaceId === workspace.id && binding.verificationStatus === 'verified').length;
     const button = createWorkspaceNavigationButton(document, workspace, {
       repositoryCount,
       selected: selectedWorkspace?.id === workspace.id,
       onSelect: () => selectWorkspace(workspace, data),
       onContextMenu: openWorkspaceContextMenu,
     });
     item.append(button);
      item.append(...renderTasks({ workspace, tasks }));
     return item;
  };
  workspaceList.replaceChildren(...(regular.length ? regular.map((entry) => renderWorkspace(entry)) : [Object.assign(document.createElement('li'), { className: 'placeholder', textContent: 'No workspaces yet' })]));
  if (selectedWorkspace) renderAttachedRepositories(selectedWorkspace.id, data);
  syncNewWorkTaskOption();
}

function closeWorkspaceContextMenu(restoreFocus = false) {
  workspaceContextMenu.hidden = true;
  contextMenuTrigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) contextMenuTrigger?.focus();
  contextMenuWorkspace = null;
  contextMenuTrigger = null;
}

function openWorkspaceContextMenu(workspace, left, top, trigger) {
  if (workspace.kind !== 'regular' || workspace.status !== 'active') return;
  contextMenuTrigger?.setAttribute('aria-expanded', 'false');
  contextMenuWorkspace = workspace;
  contextMenuTrigger = trigger;
  contextMenuTrigger?.setAttribute('aria-expanded', 'true');
  workspaceContextMenu.hidden = false;
  const bounds = workspaceContextMenu.getBoundingClientRect();
  workspaceContextMenu.style.left = `${Math.max(0, Math.min(left, window.innerWidth - bounds.width))}px`;
  workspaceContextMenu.style.top = `${Math.max(0, Math.min(top, window.innerHeight - bounds.height))}px`;
  workspaceContextMenu.querySelector('[role="menuitem"]').focus();
}

workspaceContextMenu.querySelector('#workspace-context-new-task').addEventListener('click', () => {
  const workspace = contextMenuWorkspace;
  closeWorkspaceContextMenu();
  if (workspace) openNewWork('task', workspace.id);
});
document.addEventListener('pointerdown', (event) => {
  if (!workspaceContextMenu.hidden && !workspaceContextMenu.contains(event.target)) closeWorkspaceContextMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !workspaceContextMenu.hidden) {
    event.preventDefault();
    closeWorkspaceContextMenu(true);
  }
});

function renderAttachedRepositories(workspaceId, data = navigationData) {
  const bindings = (data.workspaceRepositories || []).filter((binding) => binding.workspaceId === workspaceId);
  const repositories = new Map((window.repositoryCatalog || []).map((repository) => [repository.id, repository]));
  document.querySelector('#attached-repositories').replaceChildren(...(bindings.length
    ? bindings.map((binding) => Object.assign(document.createElement('li'), {
      textContent: `${repositories.get(binding.repositoryId)?.name || binding.repositoryId} · ${binding.branch} · ${binding.verificationStatus}`,
      title: binding.checkoutPath,
    }))
    : [Object.assign(document.createElement('li'), { textContent: 'None attached' })]));
}

function selectWorkspace(workspace, data = navigationData) {
  document.querySelector('#directories-page').hidden = true;
  fullRequestDestination.hidden = true;
  document.querySelector('#workbench').hidden = false;
  document.querySelector('#right-content').classList.remove('quick-request-terminal-page');
  document.querySelector('#quick-request-terminal-actions').hidden = true;
  selectedOwner.classList.remove('proposal-mode');
  document.querySelector('#right-content').classList.add('owner-active');
  workspaceStatus.textContent = '';
  currentTaskSetupNotice = null;
  selectedWorkspace = workspace;
  selectedTask = null;
  selectedOwnerRepositoryCount = (data.workspaceRepositories || []).filter((binding) => binding.workspaceId === workspace.id && binding.verificationStatus === 'verified').length;
  showOwnerTerminal();
  syncChangeReviewAvailability();
  syncRepositoryToolsAvailability();
  syncOwnerControls();
  noSelection.hidden = true; workbench.hidden = false; selectedOwner.hidden = false; newWork.hidden = true; newWorkReview.hidden = true;
  workspaceTitle.textContent = workspace.name;
  workspaceDescription.textContent = `${workspace.description || 'Workspace ready for planning and tasks.'} · ${workspace.status}`;
  const disabled = workspace.status !== 'active';
  document.querySelector('#attach-repository').disabled = disabled;
  document.querySelector('#workspace-session-submit').disabled = disabled || !modelsReady;
  document.querySelector('#complete-workspace').disabled = disabled;
  document.querySelector('#reactivate-workspace').disabled = workspace.status !== 'completed';
  setTaskSetupControls(null);
  renderNavigation(data);
  syncOwnerSessions();
  syncPendingPrompt();
  void restoreTrackedOwnerSession({ type: 'workspace', id: workspace.id });
}

function selectTask(task, workspace, data = navigationData) {
  document.querySelector('#directories-page').hidden = true;
  fullRequestDestination.hidden = true;
  const isQuickRequest = Boolean(task.quickRequest);
  document.querySelector('#workbench').hidden = isQuickRequest;
  document.querySelector('#right-content').classList.toggle('quick-request-terminal-page', isQuickRequest);
  document.querySelector('#quick-request-terminal-actions').hidden = !isQuickRequest;
  selectedOwner.classList.remove('proposal-mode');
  document.querySelector('#right-content').classList.add('owner-active');
  workspaceStatus.textContent = '';
  currentTaskSetupNotice = null;
  selectedWorkspace = workspace;
  selectedTask = task;
  selectedOwnerRepositoryCount = 0;
  showOwnerTerminal();
  syncChangeReviewAvailability();
  syncRepositoryToolsAvailability();
  syncOwnerControls();
  noSelection.hidden = true; workbench.hidden = isQuickRequest; selectedOwner.hidden = false; newWork.hidden = true; newWorkReview.hidden = true;
  workspaceTitle.textContent = task.name;
  workspaceDescription.textContent = `${task.description || 'Task'} · ${task.status}`;
  document.querySelector('#attach-repository').disabled = workspace.status !== 'active';
  document.querySelector('#workspace-session-submit').disabled = workspace.status !== 'active' || !modelsReady;
  document.querySelector('#complete-workspace').disabled = workspace.status !== 'active';
  document.querySelector('#reactivate-workspace').disabled = workspace.status !== 'completed';
  setTaskSetupControls(task);
  renderNavigation(data);
  syncOwnerSessions();
  syncPendingPrompt();
  void refreshTaskSetup().catch((error) => { workspaceStatus.textContent = formatWorkspaceError('Refresh setup', error); });
  void restoreTrackedOwnerSession({ type: 'task', id: task.id });
}

function setTaskSetupControls(task) {
  const hasTask = Boolean(task);
  document.querySelector('#task-setup-cancel').disabled = !hasTask || task.setupStatus !== 'in_progress';
  document.querySelector('#task-setup-resume').disabled = !hasTask || task.setupStatus !== 'incomplete';
  document.querySelector('#task-setup-resume').textContent = task?.setupOperationId
    ? 'Resume setup' : 'Retry repository setup';
  document.querySelector('#task-setup-refresh').disabled = !hasTask;
   document.querySelector('#new-task-session').disabled = !hasTask || task.status !== 'active';
   document.querySelector('#complete-task').disabled = !hasTask || task.status !== 'active';
   document.querySelector('#retry-cleanup').disabled = !hasTask || task.status !== 'completed';
   void refreshCleanupHistory();
}

async function refreshCleanupHistory() {
  const history = document.querySelector('#cleanup-history');
  if (!selectedTask) { history.replaceChildren(); return; }
  try {
    const jobs = await listTaskCleanupJobs(invoke, selectedTask.id);
     history.replaceChildren(...(jobs.length ? jobs.map((job) => {
       const reason = job.deferralReason;
       const failure = job.failureDetail;
       const details = [
         reason ? `deferred: ${reason}` : '',
         failure ? `error: ${failure}` : '',
       ].filter(Boolean).join(' · ');
       return Object.assign(document.createElement('li'), {
         textContent: `${job.repositoryId}: ${job.state}${details ? ` · ${details}` : ''}`,
       });
     }) : [Object.assign(document.createElement('li'), { textContent: 'No worktree cleanup jobs.' })]));
  } catch (error) { history.replaceChildren(Object.assign(document.createElement('li'), { textContent: `Cleanup status unavailable: ${String(error)}` })); }
}

async function refreshTaskSetup() {
  if (!selectedTask || selectedTask.quickRequest) return null;
  const requestedTaskId = selectedTask.id;
  const status = await getTaskSetupStatus(invoke, requestedTaskId);
  if (selectedTask?.id !== requestedTaskId) return status;
  selectedTask = status.task;
  selectedOwnerRepositoryCount = (status.repositories || []).filter((binding) => binding.setupStatus === 'ready').length;
  syncChangeReviewAvailability();
  syncRepositoryToolsAvailability();
  const setupNotice = taskSetupStatusNotice(status);
  if (setupNotice) {
    currentTaskSetupNotice = setupNotice;
    workspaceStatus.textContent = setupNotice;
  } else {
    if (currentTaskSetupNotice && workspaceStatus.textContent === currentTaskSetupNotice) {
      workspaceStatus.textContent = '';
    }
    currentTaskSetupNotice = null;
  }
  setTaskSetupControls(selectedTask);
  return status;
}

document.querySelector('#task-setup-refresh').addEventListener('click', () => {
  void refreshTaskSetup().catch((error) => { workspaceStatus.textContent = formatWorkspaceError('Refresh setup', error); });
});
document.querySelector('#new-task-session').addEventListener('click', async () => {
  if (!selectedTask) return;
  try {
    const status = await getTaskSetupStatus(invoke, selectedTask.id);
    const ready = (status.repositories || []).filter((binding) => binding.setupStatus === 'ready');
    if (!ready.length) throw new Error('This task has no ready repository worktrees.');
    const repositoryId = window.prompt(`Repository ID for the new empty session:\n${ready.map((binding) => binding.repositoryId).join('\n')}`);
    if (!repositoryId) return;
    if (!ready.some((binding) => binding.repositoryId === repositoryId.trim())) throw new Error('Choose one of the listed ready repository IDs.');
    const selectedModel = JSON.parse(model.value);
    const record = await createTaskSession(invoke, selectedTask.id, repositoryId.trim(), selectedModel);
    await showSession(record.openCodeSessionId);
  }
  catch (error) { workspaceStatus.textContent = formatWorkspaceError('New task session', error); }
});
document.querySelector('#complete-task').addEventListener('click', async () => {
  if (!selectedTask || selectedTask.status !== 'active') return;
  try { const result = await completeTask(invoke, selectedTask.id); selectedTask = result.task; workspaceStatus.textContent = 'Task completed; code and sessions were preserved.'; await refreshNavigation(); await refreshCleanupHistory(); setTaskSetupControls(selectedTask); }
  catch (error) { workspaceStatus.textContent = formatWorkspaceError('Complete task', error); }
});
document.querySelector('#complete-workspace').addEventListener('click', async () => {
  if (!selectedWorkspace || selectedWorkspace.status !== 'active') return;
  try {
    const result = await completeWorkspace(invoke, selectedWorkspace.id);
    selectedWorkspace = result;
    workspaceStatus.textContent = 'Workspace completed; homes, history, and running sessions were preserved.';
    await refreshNavigation();
    selectWorkspace(result, navigationData);
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Complete workspace', error); }
});
document.querySelector('#reactivate-workspace').addEventListener('click', async () => {
  if (!selectedWorkspace || selectedWorkspace.status !== 'completed') return;
  try {
    const result = await reactivateWorkspace(invoke, selectedWorkspace.id);
    selectedWorkspace = result;
    workspaceStatus.textContent = 'Workspace reactivated. New tasks and sessions are enabled.';
    await refreshNavigation();
    selectWorkspace(result, navigationData);
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Reactivate workspace', error); }
});
document.querySelector('#retry-cleanup').addEventListener('click', async () => {
  if (!selectedTask) return;
  try { await retryTaskCleanup(invoke, selectedTask.id); await refreshCleanupHistory(); }
  catch (error) { workspaceStatus.textContent = formatWorkspaceError('Retry cleanup', error); }
});
document.querySelector('#task-setup-cancel').addEventListener('click', async () => {
  if (!selectedTask) return;
  try { selectedTask = await cancelTaskSetup(invoke, selectedTask.id); await refreshTaskSetup(); }
  catch (error) { workspaceStatus.textContent = formatWorkspaceError('Cancel setup', error); }
});
document.querySelector('#task-setup-resume').addEventListener('click', async () => {
  if (!selectedTask) return;
  try {
    if (!selectedTask.setupOperationId) {
      const result = await retryTaskSetup(invoke, selectedTask.id, JSON.parse(model.value));
      selectedTask = result.task;
      await refreshTaskSetup();
      if (result.sessions?.length) await showSession(result.sessions[0].openCodeSessionId);
      return;
    }
    const task = await resumeTaskSetup(invoke, selectedTask.id, selectedTask.setupOperationId, selectedTask.setupSessionId);
    selectedTask = task;
     const status = await getTaskSetupStatus(invoke, task.id);
      if (!status.session) throw new Error('Task setup session was not found.');
      await showSession(status.session.openCodeSessionId);
      workspaceStatus.textContent = 'Opened the legacy setup conversation. New task setup is managed by Rust; use the repository terminals shown for current work.';
    await refreshTaskSetup();
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Resume setup', error); }
});

async function refreshNavigation() { const data = await loadWorkspaceNavigation(invoke); renderNavigation(data); return data; }
const newWorkDialog = document.querySelector('#new-work-dialog');
function openNewWork(workType = 'workspace', workspaceId = null) {
  requestedNewWorkType = workType;
  newWorkWorkspaceContext = workspaceId;
  const labels = {
    workspace: ['Workspace', 'Describe the workspace you want to create.', 'New Workspace'],
    task: ['Task', 'Describe the task for the selected workspace.', 'New Task'],
    quick_request: ['Quick Request', 'What do you want OpenCode to do?', 'New Quick Request'],
  }[workType];
  document.querySelector('#new-work-kind').textContent = labels[0];
  document.querySelector('#new-work-title').textContent = labels[2];
  document.querySelector('#new-work-guidance').textContent = labels[1];
  document.querySelector('#new-work-dialog').setAttribute('aria-label', labels[2]);
  newWorkDialog.classList.remove('proposal-open');
  newWork.hidden = false;
  newWorkReview.hidden = true;
  newWorkPrompt.value = '';
  taskWorkspaceField.hidden = workType !== 'task';
  taskWorkspaceSelect.disabled = workType !== 'task';
  taskWorkspaceSelect.required = workType === 'task';
  if (workType === 'task') populateTaskWorkspace(workspaceId);
  syncNewWorkContinueButton();
  document.querySelector('#new-work-error').textContent = '';
  if (!newWorkDialog.open) newWorkDialog.showModal();
  newWorkPrompt.focus();
}
let requestedNewWorkType = 'workspace';
const newWorkMenu = document.querySelector('#new-work-menu');
function syncNewWorkTaskOption() {
  document.querySelector('[data-new-work-type="task"]').disabled = taskWorkspaceOptions(navigationData.workspaces).length === 0;
}
function populateTaskWorkspace(preferredId = null) {
  newWorkWorkspaceContext = populateTaskWorkspaceSelector(
    taskWorkspaceSelect,
    navigationData.workspaces,
    preferredId,
  );
}
function syncNewWorkContinueButton() {
  const continueButton = document.querySelector('#new-work-capture button[type="submit"]');
  continueButton.disabled = requestedNewWorkType === 'task' && !taskWorkspaceSelect.value;
}
taskWorkspaceSelect.addEventListener('change', () => {
  newWorkWorkspaceContext = taskWorkspaceSelect.value || null;
  syncNewWorkContinueButton();
});
newWorkMenu.querySelectorAll('[data-new-work-type]').forEach((button) => {
  button.addEventListener('click', () => {
    const type = button.dataset.newWorkType;
    newWorkMenu.open = false;
    openNewWork(type);
  });
});
syncNewWorkTaskOption();
document.querySelector('#new-work-cancel').addEventListener('click', async () => {
  if (proposalSessionId) {
    try { await closeProposalSession(); }
    catch { return; }
  }
  newWorkWorkspaceContext = null;
  newWorkDialog.close();
 });
document.querySelector('#proposal-cancel').addEventListener('click', () => document.querySelector('#new-work-cancel').click());
newWorkDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  document.querySelector('#new-work-cancel').click();
});
newWorkDialog.addEventListener('click', (event) => {
  if (event.target === newWorkDialog) document.querySelector('#new-work-cancel').click();
});
async function renderProposal(proposal, originalPrompt) {
  currentProposal = proposal;
  proposalCreate.disabled = false;
  const workTypeName = proposal.workType === 'quick_request'
    ? 'Quick Request'
    : proposal.workType === 'task' ? 'Task' : 'Workspace';
  proposalCreate.textContent = proposal.workType === 'quick_request'
    ? 'Start Quick Request'
    : `Create ${workTypeName}`;
  const matchedWorkspace = proposal.workspace?.id ? navigationData.workspaces.find((entry) => entry.id === proposal.workspace.id) : null;
  document.querySelector('#proposal-original').textContent = originalPrompt;
  const workspaceReviewForm = document.querySelector('#workspace-review-form');
  const taskReviewDetails = document.querySelector('#task-review-details');
  workspaceReviewForm.hidden = proposal.workType !== 'workspace';
  taskReviewDetails.hidden = proposal.workType !== 'task';
  if (proposal.workType === 'workspace') {
    const details = workspaceReviewDetails(proposal);
    document.querySelector('#workspace-review-name').value = details.name;
    document.querySelector('#workspace-review-directory').textContent = details.directory;
    document.querySelector('#workspace-original-prompt').value = originalPrompt;
  }
  if (proposal.workType === 'task') {
    const workspaceHome = matchedWorkspace?.homePath?.replace(/\/+$/, '') || '';
    document.querySelector('#task-review-name').value = proposal.task?.name || '';
    document.querySelector('#task-review-intent').value = proposal.task?.intent || '';
    document.querySelector('#task-review-workspace').textContent = matchedWorkspace?.name || proposal.workspace?.name || 'Workspace unavailable';
    document.querySelector('#task-review-directory').textContent = workspaceHome
      ? `${workspaceHome}/tasks/ (a unique Task folder will be created here)`
      : 'Workspace task directory unavailable';
    document.querySelector('#task-original-prompt').value = originalPrompt;
    document.querySelector('#task-revised-prompt').value = proposal.startingPrompt || '';
  }
  const repositoryList = document.querySelector('#proposal-repositories');
  const repositoryLocations = workspaceProposalRepositoryLocations(proposal.repositories, window.repositoryCatalog);
  document.querySelector('#proposal-repository-section').hidden = proposal.workType === 'quick_request';
  repositoryList.replaceChildren(...(repositoryLocations.length
    ? repositoryLocations.map(({ name, path }) => Object.assign(document.createElement('li'), {
      textContent: `${name} — ${path}`,
    }))
    : [Object.assign(document.createElement('li'), { textContent: 'None' })]));
  document.querySelector('#proposal-prompt').value = workspaceStartingPrompt(proposal);
  document.querySelector('#proposal-starting-prompt').hidden = proposal.workType !== 'workspace';
  proposalCreate.textContent = proposal.workType === 'task'
    ? 'Create Task'
    : proposal.workType === 'quick_request' ? 'Confirm directory and start Quick Request' : 'Create Workspace';
  const quickDirectoryReview = document.querySelector('#quick-request-directory-review');
  quickDirectoryReview.hidden = proposal.workType !== 'quick_request';
  if (proposal.workType === 'quick_request') {
    document.querySelector('#proposal-title').textContent = 'New Quick Request — Confirm directory';
    document.querySelector('#quick-request-original').textContent = originalPrompt;
    const directorySelect = document.querySelector('#quick-request-directory');
    const catalog = window.repositoryCatalog || [];
    const proposedId = proposal.repositories[0]?.repositoryId;
    directorySelect.replaceChildren(
      new Option('Shared default Quick Request directory', ''),
      ...catalog.map((repository) => new Option(`${repository.name} — ${repository.repositoryPath}`, repository.id)),
    );
    directorySelect.value = catalog.some((repository) => repository.id === proposedId) ? proposedId : '';
    await refreshQuickRequestDirectoryPath();
  } else {
    document.querySelector('#proposal-title').textContent = `Review New ${workTypeName}`;
  }
  const progressAnchor = proposal.workType === 'workspace'
    ? document.querySelector('#proposal-starting-prompt')
    : proposal.workType === 'task' ? taskReviewDetails : quickDirectoryReview;
  progressAnchor.after(progressPanel);
}

async function refreshQuickRequestDirectoryPath() {
  const directorySelect = document.querySelector('#quick-request-directory');
  const pathLabel = document.querySelector('#quick-request-directory-path');
  const requestedRepositoryId = directorySelect.value || null;
  pathLabel.textContent = 'Resolving directory…';
  quickRequestDirectoryReady = false;
  proposalCreate.disabled = true;
  try {
    const resolvedPath = await resolveQuickRequestDirectory(invoke, requestedRepositoryId);
    if ((directorySelect.value || null) !== requestedRepositoryId) return;
    pathLabel.textContent = resolvedPath;
    quickRequestDirectoryReady = true;
    proposalCreate.disabled = false;
  } catch (error) {
    if ((directorySelect.value || null) !== requestedRepositoryId) return;
    pathLabel.textContent = formatWorkspaceError('Resolve Quick Request directory', error);
  }
}
document.querySelector('#quick-request-directory').addEventListener('change', () => {
  void refreshQuickRequestDirectoryPath();
});
document.querySelector('#new-work-capture').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!newWorkPrompt.value.trim()) return;
  const continueButton = document.querySelector('#new-work-capture button[type="submit"]');
  const error = document.querySelector('#new-work-error'); error.textContent = '';
  continueButton.disabled = true;
  resetProgress();
  setProgress('interpret', 'Interpret request', 'running');
  try {
    if (proposalSessionId) await closeProposalSession();
    const requestedType = requestedNewWorkType;
    if (requestedType === 'task') {
      newWorkWorkspaceContext = taskWorkspaceSelect.value || null;
      if (!taskWorkspaceOptions(navigationData.workspaces).some((workspace) => workspace.id === newWorkWorkspaceContext)) {
        throw new Error('Choose an active workspace before creating a task.');
      }
    }
    if (requestedType === 'quick_request') await refreshCatalog();
    const selectedModel = JSON.parse(proposalModel.value);
    const started = await startNewWorkProposal(invoke, selectedModel);
    proposalSessionId = started.sessionId;
    // Proposal sessions are request/response-only and never enter the terminal
    // session registry or normal session reconciliation.
    const proposal = await runNewWorkProposal(
      invoke,
      proposalSessionId,
      newWorkPrompt.value,
      requestedType === 'task' ? newWorkWorkspaceContext : undefined,
      requestedType,
    );
    setProgress('interpret', 'Interpret request', 'success');
    await renderProposal(proposal, newWorkPrompt.value);
    newWork.hidden = true; newWorkReview.hidden = false;
    newWorkDialog.classList.add('proposal-open');
    newWorkDialog.setAttribute('aria-label', document.querySelector('#proposal-title').textContent);
  } catch (failure) {
    setProgress('interpret', 'Interpret request', 'failed', String(failure));
    error.textContent = formatWorkspaceError('Prepare proposal', failure);
  }
  finally { continueButton.disabled = false; }
});
document.querySelector('#proposal-back').addEventListener('click', () => {
  newWorkReview.hidden = true;
  newWork.hidden = false;
  newWorkDialog.classList.remove('proposal-open');
  const title = document.querySelector('#new-work-title').textContent;
  newWorkDialog.setAttribute('aria-label', title);
  newWorkPrompt.focus();
});
proposalCreate.addEventListener('click', async () => {
  if (!currentProposal || !modelsReady
    || (currentProposal.workType === 'quick_request' && !quickRequestDirectoryReady)) return;
  proposalCreate.disabled = true;
  ownerSetupBusy = true;
  const proposalError = document.querySelector('#proposal-error'); proposalError.textContent = '';
  ownerSetupNotice = '';
  progressProposalSessionId = proposalSessionId;
  let ownerCreated = false;
  try {
    const selectedModel = JSON.parse(proposalModel.value); const startingPrompt = document.querySelector('#proposal-prompt').value;
    const workspaceName = document.querySelector('#workspace-review-name').value.trim();
    if (currentProposal.workType === 'quick_request') {
      const originalPrompt = newWorkPrompt.value;
      const selectedRepositoryId = document.querySelector('#quick-request-directory').value || null;
      await submitResolvedQuickRequestFlow({
        invoke,
        originalPrompt,
        model: selectedModel,
        repositoryId: selectedRepositoryId,
        waitForTerminal: async () => {
          if (!await terminalRuntime) throw new Error('Terminal runtime is unavailable.');
        },
        onCreated: (record) => {
          ownerCreated = true;
          const quickWorkspace = navigationData.workspaces.find((entry) => entry.id === record.task.workspaceId)
            || { id: record.task.workspaceId, name: 'Quick Requests', kind: 'quick_requests', status: 'active' };
          selectTask(record.task, quickWorkspace, navigationData);
        },
        showSession,
        refreshRequests,
      });
    } else if (currentProposal.workType === 'task') {
      const workspaceId = currentProposal.workspace.id;
      const taskName = document.querySelector('#task-review-name').value.trim();
      const taskIntent = document.querySelector('#task-review-intent').value.trim();
      if (!taskName) throw new Error('Task name is required.');
      if (!taskIntent) throw new Error('Task intent is required.');
      const created = await createWorkspaceTask(
        invoke,
        workspaceId,
        selectedModel,
        taskName,
        taskIntent,
        currentProposal.repositories.map((repository) => repository.repositoryId),
      );
      ownerCreated = true;
      const task = created.task;
      const currentWorkspace = navigationData.workspaces.find((entry) => entry.id === task.workspaceId)
        || { ...currentProposal.workspace, status: 'active', kind: 'regular' };
      selectTask(task, currentWorkspace, navigationData);
      const data = await refreshNavigation();
      const workspace = data.workspaces.find((entry) => entry.id === task.workspaceId) || currentWorkspace;
      selectTask(task, workspace, data);
      const failed = (created.repositories || []).filter((entry) => entry.setupStatus !== 'ready' || entry.sessionError);
      workspaceStatus.textContent = failed.length
        ? `Task created with setup issues: ${failed.map((entry) => `${entry.repositoryId}: ${entry.errorDetail || entry.sessionError || entry.setupStatus}`).join('; ')}`
        : '';
      if (created.sessions?.length) await showSession(created.sessions[0].openCodeSessionId);
    } else {
      if (!workspaceName) throw new Error('Workspace name is required.');
      setProgress('workspace', 'Create workspace', 'running');
      const initialized = await createInitializedWorkspace(
        invoke,
        workspaceName,
        selectedModel,
        currentProposal.workspace.intent || null,
        proposalSessionId,
      );
      ownerCreated = true;
      selectWorkspace(initialized.workspace, navigationData);
      const data = await refreshNavigation();
      selectWorkspace(selectCreatedWorkspace(data, initialized.workspace), data);
      const setupFailures = initialized.setup.filter((entry) => entry.setupStatus === 'failed');
      const sessionErrors = initialized.sessionErrors || [];
      await refreshNavigation();
      if (setupFailures.length) {
        setProgress('workspace-result', 'Workspace create', 'failed', setupFailures.map((entry) => `${entry.repositoryId}: ${entry.errorDetail}`).join('\n'));
        proposalError.textContent = 'Workspace create failed. Review the failed repository step(s), then choose Retry setup.';
        proposalCreate.textContent = 'Retry setup';
        ownerCreated = false; // Rust binds this proposal to the durable workspace for idempotent retry.
        return;
      }
      const workspaceSessions = initialized.sessions || [];
      for (const session of workspaceSessions) await showSession(session.openCodeSessionId);
      if (sessionErrors.length) {
        setProgress('workspace-result', 'Workspace create', 'failed', sessionErrors.join('\n'));
        proposalError.textContent = 'Workspace create failed while starting a terminal. Review the details, then choose Retry session.';
        proposalCreate.textContent = 'Retry session';
        ownerCreated = false;
        return;
      }
      if (!workspaceSessions.length) {
        setProgress('workspace-result', 'Workspace create', 'failed', 'No workspace terminal was created.');
        proposalError.textContent = 'Workspace create failed: no terminal was created.';
        ownerCreated = false;
        return;
      }
      await showSession(workspaceSessions[0].openCodeSessionId);
      const multiRepositoryWorkspace = currentProposal.repositories.length > 1;
       if (!multiRepositoryWorkspace && shouldSubmitWorkspaceStartingPrompt(startingPrompt)) {
        const session = workspaceSessions[0];
        const workspacePromptAction = { type: 'workspace', ownerKey: `workspace:${initialized.workspace.id}`, sessionId: session.openCodeSessionId, model: selectedModel };
        setProgress('starting-prompt', 'Submit starting prompt', 'running');
        await submitNewWorkStartingPrompt(invoke, workspacePromptAction, startingPrompt);
        setProgress('starting-prompt', 'Submit starting prompt', 'success');
       } else if (!multiRepositoryWorkspace) {
        setProgress('starting-prompt', 'Submit starting prompt', 'skipped', 'No starting prompt was provided.');
       }
      setProgress('workspace-result', 'Workspace create', 'success');
      workspaceStatus.textContent = '';
    }
    newWorkReview.hidden = true; currentProposal = null;
    proposalCreate.textContent = 'Create';
    newWorkDialog.close();
    if (proposalSessionId) {
      try { await closeProposalSession(); }
      catch (error) {
        // Owner creation is already committed. Keep the new owner's pending
        // session selected and report the still-attached proposal terminal
        // without returning to a create action that could duplicate the owner.
        workspaceStatus.textContent = formatWorkspaceError('Close proposal terminal', error);
      }
    }
  } catch (error) {
    if (currentProposal?.workType === 'workspace') {
      setProgress('workspace-result', 'Workspace create', 'failed', String(error));
    }
    if (ownerCreated) {
      const quickRequestFailure = currentProposal?.workType === 'quick_request';
      // Creation already committed. Leave the owner selected and do not expose
      // a Create action that could make a duplicate owner after a later attach,
      // refresh, terminal-mount, or prompt-send failure.
      newWorkReview.hidden = true;
      currentProposal = null;
      newWorkDialog.close();
      const message = formatWorkspaceError('Finish owner setup', error);
      workspaceStatus.textContent = message;
      if (quickRequestFailure) {
        setAppNotice(message);
        void refreshRequests().catch((refreshError) => {
          setAppNotice(`${message} · Quick Request list refresh failed: ${String(refreshError)}`);
        });
      }
      pendingPromptAction = null;
    } else proposalError.textContent = formatWorkspaceError('Create work', error);
  }
  finally {
    ownerSetupBusy = false;
    syncPendingPrompt();
    proposalCreate.disabled = ownerCreated
      || (currentProposal?.workType === 'quick_request' && !quickRequestDirectoryReady);
  }
});
document.querySelector('#submit-starting-prompt')?.addEventListener('click', async () => {
  if (!pendingPromptAction) return;
  const button = document.querySelector('#submit-starting-prompt');
  const promptText = document.querySelector('#pending-prompt-text').value;
    if (!promptText.trim()) { workspaceStatus.textContent = 'Enter a starting prompt first.'; return; }
  button.disabled = true;
  try {
    await showSession(pendingPromptAction.sessionId);
    if (pendingPromptAction.type === 'task') {
      await submitNewWorkStartingPrompt(invoke, pendingPromptAction, promptText);
      workspaceStatus.textContent = 'Task setup started. Follow setup status here and interact in the terminal.';
    } else if (pendingPromptAction.type === 'quick_request') {
      await submitNewWorkStartingPrompt(invoke, pendingPromptAction, promptText);
      workspaceStatus.textContent = 'Quick Request started in its interactive terminal.';
    } else {
      await submitNewWorkStartingPrompt(invoke, pendingPromptAction, promptText);
      workspaceStatus.textContent = `${ownerSetupNotice ? `${ownerSetupNotice} ` : ''}Starting prompt submitted to the interactive terminal.`;
    }
    pendingPromptAction = null;
    document.querySelector('#pending-starting-prompt').hidden = true;
    await refreshTaskSetup();
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Submit starting prompt', error); }
  finally { button.disabled = false; }
});
async function closeProposalSession() {
  const sessionId = proposalSessionId;
  if (!sessionId) return;
  try { await closeNewWorkProposal(invoke, sessionId); }
  catch (error) {
    const message = formatWorkspaceError('Close proposal terminal', error);
    workspaceStatus.textContent = message;
    commandResult.textContent = message;
    throw error;
  }
  const runtime = await terminalRuntime;
  runtime?.forget(sessionId);
  document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`)?.remove();
  sessionTabs.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`)?.remove();
  openSessions.delete(sessionId);
  sessionOwners.delete(sessionId);
  if (selectedSessionByOwner.get('proposal') === sessionId) selectedSessionByOwner.delete('proposal');
  proposalSessionId = null;
  selectedOwner.classList.remove('proposal-mode');
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
    workspaceStatus.textContent = message;
    commandResult.textContent = message;
    return;
  }
  const runtime = await terminalRuntime;
  runtime?.forget(sessionId);
  document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`)?.remove();
  sessionTabs.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`)
    ?.parentElement?.remove();
  openSessions.delete(sessionId);
  sessionOwners.delete(sessionId);
  repositoryToolTerminals.delete(sessionId);
  const installKey = repositoryInstallTerminalKeys.get(sessionId);
  if (installKey) { repositoryInstallStarted.delete(installKey); repositoryInstallTerminalKeys.delete(sessionId); }
  const ownerKey = keyForSessionOwner(selectedTask
    ? { owner_type: 'task', owner_id: selectedTask.id }
    : selectedWorkspace ? { owner_type: 'workspace', owner_id: selectedWorkspace.id } : null);
  if (selectedSessionByOwner.get(ownerKey) === sessionId) selectedSessionByOwner.delete(ownerKey);
  syncOwnerSessions();
  if (!sessionTabs.querySelector(`[data-owner-key="${CSS.escape(ownerKey || '')}"]:not([hidden])`)) {
    setSessionStatus('');
  }
}
document.querySelector('#add-repository-directories')?.addEventListener('click', async () => {
  const status = document.querySelector('#repository-status');
  const button = document.querySelector('#add-repository-directories');
  button.disabled = true;
  status.textContent = 'Choose repository directories…';
  try {
    const result = await addRepositoryDirectories(invoke, openDirectoryPicker, () => {
      status.textContent = 'Scanning selected directories…';
    });
    if (!result) {
      status.textContent = '';
      return;
    }
    await refreshCatalog();
    await refreshDirectories();
    const errors = result.errors || [];
    status.textContent = errors.length
      ? `Added ${result.repositories.length} repositories. ${errors.join('; ')}`
      : `Added ${result.repositories.length} repositories to proposal context.`;
  } catch (error) {
    status.textContent = formatWorkspaceError('Add repository directories', error);
  } finally {
    button.disabled = false;
  }
});
async function refreshCatalog() {
   const repositories = await listRepositoryCatalog(invoke);
    window.repositoryCatalog = repositories;
    const repositorySelect = document.querySelector('#attach-repository-select');
    const selectedId = repositorySelect.value;
    repositorySelect.replaceChildren(new Option('Select an enabled repository', ''), ...repositories.map((repository) => new Option(`${repository.name} — ${repository.repositoryPath}`, repository.id)));
    repositorySelect.value = repositories.some((repository) => repository.id === selectedId) ? selectedId : '';
    if (selectedWorkspace) renderAttachedRepositories(selectedWorkspace.id, navigationData);
  return repositories;
}

document.querySelector('#attach-repository')?.addEventListener('click', async () => {
  if (!selectedWorkspace) { workspaceStatus.textContent = 'Select a workspace first.'; return; }
  const repository = (window.repositoryCatalog || []).find((entry) => entry.id === document.querySelector('#attach-repository-select').value);
  if (!repository) { workspaceStatus.textContent = 'Select an enabled repository first.'; return; }
  workspaceStatus.textContent = 'Attaching repository…';
  try {
    const setup = await attachRepository(invoke, selectedWorkspace.id, repository.id);
    workspaceStatus.textContent = setup.setupStatus === 'ready'
      ? `Attached independent workspace clone of ${repository.name}.`
      : `Repository setup needs attention: ${setup.errorDetail || setup.setupStatus}`;
    await refreshNavigation();
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Attach', error); }
});

async function refreshDirectories() {
  const page = await loadRepositoryDirectoryPage(invoke);
  const directoryList = document.querySelector('#directory-list');
  const renderRepository = (entry) => {
    const { repository, enabled } = entry;
    const item = document.createElement('li');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabled;
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      try {
        await setRepositoryEnabled(invoke, repository.id, checkbox.checked);
        await refreshDirectories();
        await refreshCatalog();
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        document.querySelector('#repository-status').textContent = formatWorkspaceError('Update repository', error);
      } finally { checkbox.disabled = false; }
    });
    label.append(checkbox, document.createTextNode(` ${repository.name} — ${repository.repositoryPath}`));
    item.append(label);
    return item;
  };
  const directories = groupRepositoryDirectories(page.directories);
  directoryList.replaceChildren(...(directories.length ? directories.map((directory) => {
    const group = document.createElement('li');
    const heading = document.createElement('h2'); heading.textContent = directory.path;
    const repositories = document.createElement('ul');
    repositories.replaceChildren(...(directory.repositories.length
      ? directory.repositories.map(renderRepository)
      : [Object.assign(document.createElement('li'), { textContent: 'No repositories discovered here.' })]));
    group.append(heading, repositories);
    return group;
  }) : [Object.assign(document.createElement('li'), { textContent: 'No directories saved yet.' })]));
}

async function showDirectoriesPage() {
  await refreshDirectories();
  fullRequestDestination.hidden = true;
  document.querySelector('#directories-page').hidden = false;
  document.querySelector('#no-selection').hidden = true;
  document.querySelector('#selected-owner').hidden = true;
  document.querySelector('#workbench').hidden = true;
  document.querySelector('#right-content').classList.remove('owner-active', 'quick-request-terminal-page');
}

async function scanSavedRepositoryDirectories() {
  const page = await loadRepositoryDirectoryPage(invoke);
  const roots = page.directories.map((entry) => entry.path);
  if (roots.length) await scanRepositories(invoke, roots);
  await refreshCatalog();
}

document.querySelector('#show-directories').addEventListener('click', () => {
  void showDirectoriesPage().catch((error) => { document.querySelector('#repository-status').textContent = String(error); });
});
document.querySelector('#directories-back').addEventListener('click', () => {
  document.querySelector('#directories-page').hidden = true;
  document.querySelector('#no-selection').hidden = false;
});
async function forgetDeletedQuickRequestTerminal(sessionId) {
  const ownerKey = sessionOwners.get(sessionId);
  const runtime = await terminalRuntime;
  runtime?.forget(sessionId);
  document.querySelector(`[data-terminal-session="${CSS.escape(sessionId)}"]`)?.remove();
  sessionTabs.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`)?.parentElement?.remove();
  openSessions.delete(sessionId);
  sessionOwners.delete(sessionId);
  if (ownerKey && selectedSessionByOwner.get(ownerKey) === sessionId) selectedSessionByOwner.delete(ownerKey);
  syncOwnerSessions();
}
document.querySelector('#workspace-session-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!modelsReady) { workspaceStatus.textContent = 'Models are still loading; try again shortly.'; return; }
  if (!selectedWorkspace) { workspaceStatus.textContent = 'Select an active workspace first.'; return; }
  const submitButton = document.querySelector('#workspace-session-submit'); submitButton.disabled = true; workspaceStatus.textContent = 'Starting workspace session…';
   try { const selectedModel = JSON.parse(model.value); const record = await createWorkspaceSession(invoke, selectedWorkspace.id, document.querySelector('#workspace-prompt').value, selectedModel); await showSession(record.openCodeSessionId); workspaceStatus.textContent = 'Workspace session started.'; } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Workspace session', error); } finally { submitButton.disabled = !modelsReady || selectedWorkspace.status !== 'active'; }
});
document.querySelector('#show-history').addEventListener('click', () => {
  void showQuickRequestList().catch((error) => { errorMessage.textContent = String(error); });
});

async function refreshRequests(history = false) {
  const allRecords = await listQuickRequests(invoke, history);
  const query = history ? fullRequestSearch.value.trim().toLocaleLowerCase() : '';
  const records = query
    ? allRecords.filter((record) => (record.prompt ?? 'Prompt unavailable').toLocaleLowerCase().includes(query))
    : allRecords;
  const target = history ? fullRequestList : list;
  target.replaceChildren(...(records.length ? records.map((record) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    const promptText = record.prompt ?? 'Prompt unavailable';
    button.textContent = history ? 'Open' : promptText;
    if (history) button.setAttribute('aria-label', `Open Quick Request: ${promptText}`);
    if (!history) {
      item.className = 'quick-request-navigation-item';
      button.className = selectedTask?.id === record.task.id ? 'selected' : '';
      button.title = promptText;
    }
    button.addEventListener('click', async () => {
      try {
        const restored = await restoreQuickRequest(invoke, record.task.id);
        const quickWorkspace = navigationData.workspaces.find((entry) => entry.id === record.task.workspaceId)
          || { id: record.task.workspaceId, name: 'Quick Requests', kind: 'quick_requests', status: 'active' };
        selectTask(restored.task, quickWorkspace, navigationData);
        if (!restored.session?.openCodeSessionId) throw new Error('Quick Request has no associated session.');
        await showSession(restored.session.openCodeSessionId);
      } catch (error) {
        setAppNotice(formatWorkspaceError('Open Quick Request', error));
      }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'quiet-button quick-request-delete';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      if (!window.confirm('Delete this Quick Request from the app? Its attached terminal will close, but the OpenCode conversation will remain in OpenCode.')) return;
      remove.disabled = true;
      try {
        await deleteQuickRequest(invoke, record.task.id);
        const sessionId = record.session?.openCodeSessionId;
        if (sessionId) await forgetDeletedQuickRequestTerminal(sessionId);
        if (selectedTask?.id === record.task.id) {
          selectedTask = null;
          selectedWorkspace = null;
          syncNewWorkTaskOption();
          document.querySelector('#right-content').classList.remove('quick-request-terminal-page');
          document.querySelector('#quick-request-terminal-actions').hidden = true;
          selectedOwner.hidden = true;
          noSelection.hidden = false;
          workbench.hidden = true;
        }
        await refreshRequests(history);
        await refreshNavigation();
      } catch (error) {
        remove.disabled = false;
        setAppNotice(formatWorkspaceError('Delete Quick Request', error));
      }
    });
    item.append(button);
    if (history) {
      item.classList.add('quick-request-row');
      const prompt = document.createElement('span');
      prompt.className = 'quick-request-prompt';
      prompt.textContent = promptText;
      item.append(prompt);
      item.append(remove);
    }
    return item;
  }) : [Object.assign(document.createElement('li'), { textContent: history ? (query ? 'No Quick Requests match your search.' : 'No Quick Requests yet.') : 'None yet' })]));
}

fullRequestSearch.addEventListener('input', () => {
  void refreshRequests(true).catch((error) => setAppNotice(formatWorkspaceError('Search Quick Requests', error)));
});

async function showQuickRequestList() {
  await refreshRequests(true);
  document.querySelector('#directories-page').hidden = true;
  fullRequestDestination.hidden = false;
  document.querySelector('#no-selection').hidden = true;
  document.querySelector('#selected-owner').hidden = true;
  document.querySelector('#workbench').hidden = true;
  document.querySelector('#right-content').classList.remove('owner-active');
  document.querySelector('#right-content').classList.remove('quick-request-terminal-page');
  document.querySelector('#quick-request-terminal-actions').hidden = true;
}

document.querySelector('#quick-request-back').addEventListener('click', () => {
  void showQuickRequestList().catch((error) => setAppNotice(String(error)));
});
document.querySelector('#new-quick-request').addEventListener('click', () => {
  openNewWork('quick_request');
});

bindQuickRequestForm({
  form,
  promptInput: prompt,
  modelSelect: model,
  submitButton: submit,
  errorMessage,
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

void refreshRequests().catch((error) => { errorMessage.textContent = String(error); });
void refreshNavigation().catch((error) => { errorMessage.textContent = String(error); });
void scanSavedRepositoryDirectories().catch((error) => { workspaceStatus.textContent = `Repository scan unavailable: ${String(error)}`; });

void initializeModelSelector({
  invoke,
  select: model,
  onReady: () => { proposalModel.replaceChildren(...[...model.options].map((option) => option.cloneNode(true))); proposalModel.value = model.value; proposalModel.disabled = false; setModelControls(true); },
  onDefaultUnavailable: ({ providerId, id }) => {
    errorMessage.textContent = `Configured default model ${providerId}/${id} is unavailable; choose an available model.`;
  },
  onError: (error) => {
    setModelControls(false);
    errorMessage.textContent = `Models unavailable: ${String(error)}`;
  },
});

void refreshGlobalPendingInputs();
window.setInterval(() => { void refreshGlobalPendingInputs(); if (selectedTask) void refreshTaskSetup(); if (openSessions.size) void refreshSessionEvidence([...openSessions][0]); }, 3000);
