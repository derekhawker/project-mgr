import '@xterm/xterm/css/xterm.css';
import { invokeCommand } from './command-contract.js';
import { listen } from '@tauri-apps/api/event';
import { loadApplicationShell } from './shell.js';
import { listQuickRequests, restoreQuickRequest, dismissQuickRequest, retryQuickRequestPrompt, loadWorkspaceNavigation, createInitializedWorkspace, createWorkspaceTask, startTaskSetupPrompt, submitNewWorkStartingPrompt, getTaskSetupStatus, formatTaskSetupStatus, cancelTaskSetup, resumeTaskSetup, scanRepositories, listRepositoryCatalog, attachRepository, createWorkspaceSession, formatWorkspaceError, workspaceNavigationModel, selectCreatedWorkspace, trackedSessionForOwner, listPendingInputs, listAllPendingInputs, getSessionStatus, reconcileSession, createTaskSession, sessionStatusLabel, completeTask, listTaskCleanupJobs, retryTaskCleanup, completeWorkspace, reactivateWorkspace, promoteQuickRequest, sessionTabAttributes, terminalAccessibilityAttributes, controlErrorAttributes, createQuickRequest, startQuickRequestPrompt, startNewWorkProposal, runNewWorkProposal, closeNewWorkProposal, cleanupTerminal } from './shell.js';
import './styles.css';
import { showCleanupError } from './error-events.js';
import { bindQuickRequestForm } from './quick-request-form.js';
import { initializeModelSelector } from './model-selector.js';

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
const terminalViews = document.querySelector('#terminal-views');
const workspaceList = document.querySelector('#workspace-list');
const workspaceTitle = document.querySelector('#selected-title');
const workspaceDescription = document.querySelector('#workspace-description');
const workspaceStatus = document.querySelector('#workspace-status');
const sessionStatus = document.querySelector('#session-status');
const pendingInputs = document.querySelector('#pending-inputs');
const repositoryList = document.querySelector('#repository-list');
let selectedWorkspace = null;
let selectedTask = null;
let selectedRepository = null;
let navigationData = { workspaces: [], tasks: [], sessions: [], workspaceRepositories: [] };
const sessionTabs = document.querySelector('#session-tabs');
const openSessions = new Set();
const sessionOwners = new Map();
const selectedSessionByOwner = new Map();
let modelsReady = false;
let currentProposal = null;
let proposalSessionId = null;
let pendingPromptAction = null;
let ownerSetupNotice = '';
let ownerSetupBusy = false;
let newWorkWorkspaceContext = null;
const noSelection = document.querySelector('#no-selection');
const workbench = document.querySelector('#workbench');
const selectedOwner = document.querySelector('#selected-owner');
const newWork = document.querySelector('#new-work');
const newWorkReview = document.querySelector('#new-work-review');
const newWorkPrompt = document.querySelector('#new-work-prompt');
const proposalCreate = document.querySelector('#proposal-create');
const proposalModel = document.querySelector('#proposal-model');

function setSessionStatus(message) {
  if (!sessionStatus) return;
  sessionStatus.textContent = message;
  sessionStatus.hidden = !message;
}

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

function sessionTabLabel(proposal = false) {
  if (proposal) return 'Proposal';
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
  document.querySelector('#repository-management').hidden = isTask;
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
  const existing = selectedSessionByOwner.get(ownerKey);
  const session = trackedSessionForOwner(
    navigationData, owner.type, owner.id, existing, [...openSessions],
  );
  if (!session || selectedOwnerKey() !== ownerKey) return;
  try {
    await showSession(session.openCodeSessionId);
  } catch (error) {
    if (selectedOwnerKey() === ownerKey) {
      workspaceStatus.textContent = formatWorkspaceError('Restore tracked session', error);
    }
  }
}

async function showSession(sessionId, { proposal = false } = {}) {
  const runtime = await terminalRuntime;
  if (!runtime) throw new Error('Terminal runtime is unavailable; see the startup error above.');
  // Rust resolves the persisted id/directory and owns PTY attachment first;
  // this is intentionally before creating the xterm surface.
  const restoredSession = proposal ? null : await invokeCommand(invoke, 'opencode_session_restore', { sessionId });
  const ownerKey = proposal ? 'proposal' : keyForSessionOwner(restoredSession?.owner);
  if (ownerKey) sessionOwners.set(sessionId, ownerKey);
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
    const tab = document.createElement('button');
      tab.type = 'button'; tab.dataset.sessionId = sessionId; tab.dataset.ownerKey = ownerKey || ''; tab.textContent = sessionTabLabel(proposal);
      Object.entries(sessionTabAttributes(sessionId, true)).forEach(([name, value]) => tab.setAttribute(name, value));
      tab.setAttribute('aria-label', `Open ${tab.textContent}`);
     tab.setAttribute('aria-selected', 'true');
      tab.addEventListener('click', () => {
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
    tabItem.append(tab);
    if (!proposal) tabItem.append(close);
    sessionTabs.append(tabItem);
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
    pendingInputs.replaceChildren(...records.flatMap((record) => [...(record.permissions || []), ...(record.forms || [])].map((item) => {
      const entry = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${record.sessionId} · Input required · ${item.id || item.requestID || 'request'}`;
      button.addEventListener('click', () => void showSession(record.sessionId)); entry.append(button); return entry;
    })));
  } catch (error) {
    const text = `Pending input status unavailable: ${String(error)}`;
    pendingInputs.textContent = text;
    setAppNotice(text);
  }
}

function renderNavigation(data) {
  navigationData = data;
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
     const button = document.createElement('button');
     button.type = 'button';
     button.textContent = workspace.name;
     button.className = selectedWorkspace?.id === workspace.id ? 'selected' : '';
     button.addEventListener('click', () => selectWorkspace(workspace, data));
     item.append(button);
      item.append(...renderTasks({ workspace, tasks }));
     return item;
  };
  workspaceList.replaceChildren(...(regular.length ? regular.map((entry) => renderWorkspace(entry)) : [Object.assign(document.createElement('li'), { className: 'placeholder', textContent: 'No workspaces yet' })]));
  if (selectedWorkspace) renderAttachedRepositories(selectedWorkspace.id, data);
}

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
  selectedOwner.classList.remove('proposal-mode');
  document.querySelector('#right-content').classList.add('owner-active');
  if (terminalCard.classList.contains('is-fullscreen')) setTerminalFullscreen(false);
  workspaceStatus.textContent = '';
  selectedWorkspace = workspace;
  selectedTask = null;
  syncOwnerControls();
  noSelection.hidden = true; workbench.hidden = false; selectedOwner.hidden = false; newWork.hidden = true; newWorkReview.hidden = true;
  workspaceTitle.textContent = workspace.name;
  workspaceDescription.textContent = `${workspace.description || 'Workspace ready for planning and tasks.'} · ${workspace.status}`;
  const disabled = workspace.status !== 'active';
  document.querySelector('#new-task').disabled = disabled || workspace.kind !== 'regular';
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
  selectedOwner.classList.remove('proposal-mode');
  document.querySelector('#right-content').classList.add('owner-active');
  if (terminalCard.classList.contains('is-fullscreen')) setTerminalFullscreen(false);
  workspaceStatus.textContent = '';
  selectedWorkspace = workspace;
  selectedTask = task;
  syncOwnerControls();
  noSelection.hidden = true; workbench.hidden = false; selectedOwner.hidden = false; newWork.hidden = true; newWorkReview.hidden = true;
  workspaceTitle.textContent = task.name;
  workspaceDescription.textContent = `${task.description || 'Task'} · ${task.status}`;
  document.querySelector('#new-task').disabled = workspace.status !== 'active' || workspace.kind !== 'regular';
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
  document.querySelector('#task-setup-resume').disabled = !hasTask
    || task.setupStatus !== 'incomplete'
    || !task.setupCancelledAt;
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
  workspaceStatus.textContent = formatTaskSetupStatus(status);
  setTaskSetupControls(selectedTask);
  return status;
}

document.querySelector('#task-setup-refresh').addEventListener('click', () => {
  void refreshTaskSetup().catch((error) => { workspaceStatus.textContent = formatWorkspaceError('Refresh setup', error); });
});
document.querySelector('#new-task-session').addEventListener('click', async () => {
  if (!selectedTask) return;
  const value = window.prompt(`Prompt for a new session in ${selectedTask.name}`);
  if (!value?.trim()) return;
  try { const selectedModel = JSON.parse(model.value); const record = await createTaskSession(invoke, selectedTask.id, value.trim(), selectedModel); await showSession(record.openCodeSessionId); }
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
     const task = await resumeTaskSetup(invoke, selectedTask.id, selectedTask.setupOperationId, selectedTask.setupSessionId);
    selectedTask = task;
     const status = await getTaskSetupStatus(invoke, task.id);
     const selectedModel = JSON.parse(model.value);
     if (!status.session) throw new Error('Task setup session was not found.');
     await showSession(status.session.openCodeSessionId);
      await startTaskSetupPrompt(
        invoke,
        task.id,
        task.setupOperationId,
        status.session.openCodeSessionId,
        selectedModel,
        'Continue the previously confirmed task setup using its recorded repository selection.',
      );
    await refreshTaskSetup();
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Resume setup', error); }
});

async function refreshNavigation() { const data = await loadWorkspaceNavigation(invoke); renderNavigation(data); return data; }
const newWorkDialog = document.querySelector('#new-work-dialog');
function openNewWork(workspaceId = null) {
  newWorkWorkspaceContext = workspaceId;
  newWork.hidden = false;
  newWorkReview.hidden = true;
  newWorkPrompt.value = '';
  document.querySelector('#new-work-error').textContent = '';
  if (!newWorkDialog.open) newWorkDialog.showModal();
  newWorkPrompt.focus();
}
document.querySelector('#new-work-start').addEventListener('click', () => openNewWork());
document.querySelector('#new-task').addEventListener('click', async () => {
  if (!selectedWorkspace) { setAppNotice('Select a workspace first.'); return; }
  if (selectedWorkspace.kind !== 'regular') { setAppNotice('Tasks can only be created in a regular workspace.'); return; }
  if (selectedWorkspace.status !== 'active') { setAppNotice('Completed workspaces cannot receive new tasks.'); return; }
  openNewWork(selectedWorkspace.id);
});
const terminalCard = document.querySelector('.terminal-card');
const terminalFullscreenButton = document.querySelector('#terminal-fullscreen');
function setTerminalFullscreen(enabled) {
  document.body.classList.toggle('terminal-fullscreen-active', enabled);
  terminalCard.classList.toggle('is-fullscreen', enabled);
  terminalFullscreenButton.textContent = enabled ? 'Exit full screen' : 'Full screen';
  terminalFullscreenButton.setAttribute('aria-pressed', String(enabled));
  if (enabled) terminalFullscreenButton.focus();
}
terminalFullscreenButton.addEventListener('click', () => {
  setTerminalFullscreen(!terminalCard.classList.contains('is-fullscreen'));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && terminalCard.classList.contains('is-fullscreen')) {
    setTerminalFullscreen(false);
  }
});
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
function renderProposal(proposal, originalPrompt) {
  currentProposal = proposal;
  proposalCreate.disabled = false;
  document.querySelector('#proposal-original').textContent = originalPrompt;
  const matchedWorkspace = proposal.workspace?.id ? navigationData.workspaces.find((entry) => entry.id === proposal.workspace.id) : null;
  document.querySelector('#proposal-summary').textContent = proposal.workType === 'task'
    ? `Task in ${matchedWorkspace?.name || proposal.workspace?.name || 'Unknown workspace'} · ${proposal.task?.name || 'Untitled task'}`
    : proposal.workType === 'quick_request' ? 'Quick Request'
      : `New workspace “${proposal.workspace?.name || 'Untitled workspace'}”`;
  document.querySelector('#proposal-intent').textContent = proposal.task?.intent || proposal.workspace?.intent || '';
  const repoById = new Map((window.repositoryCatalog || []).map((repository) => [repository.id, repository]));
  document.querySelector('#proposal-repositories').textContent = proposal.repositories.length
    ? proposal.repositories.map((entry) => `${repoById.get(entry.repositoryId)?.name || entry.repositoryId} — ${entry.reason}`).join('\n') : 'None';
  document.querySelector('#proposal-jira').textContent = `${proposal.jira.action}${proposal.jira.summary ? ` · ${proposal.jira.summary}` : ''}${proposal.jira.issues.length ? ` · ${proposal.jira.issues.map((issue) => `${issue.key}: ${issue.summary}`).join(', ')}` : ''}`;
  document.querySelector('#proposal-prompt').value = proposal.startingPrompt;
  document.querySelector('#proposal-effects').textContent = proposal.effects.join('\n');
  proposalCreate.textContent = proposal.workType === 'task' ? 'Create task' : proposal.workType === 'quick_request' ? 'Create Quick Request' : 'Create workspace';
}
document.querySelector('#new-work-capture').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!newWorkPrompt.value.trim()) return;
  const continueButton = document.querySelector('#new-work-capture button[type="submit"]');
  const error = document.querySelector('#new-work-error'); error.textContent = '';
  continueButton.disabled = true;
  try {
    if (proposalSessionId) await closeProposalSession();
    const selectedModel = JSON.parse(proposalModel.value);
    const started = await startNewWorkProposal(invoke, selectedModel);
    proposalSessionId = started.sessionId;
    // Proposal sessions are request/response-only and never enter the terminal
    // session registry or normal session reconciliation.
    const proposal = await runNewWorkProposal(invoke, proposalSessionId, newWorkPrompt.value, newWorkWorkspaceContext || undefined);
    renderProposal(proposal, newWorkPrompt.value);
    newWork.hidden = true; newWorkReview.hidden = false;
  } catch (failure) {
    error.textContent = formatWorkspaceError('Prepare proposal', failure);
  }
  finally { continueButton.disabled = false; }
});
document.querySelector('#proposal-back').addEventListener('click', () => { newWorkReview.hidden = true; newWork.hidden = false; newWorkPrompt.focus(); });
proposalCreate.addEventListener('click', async () => {
  if (!currentProposal || !modelsReady) return;
  proposalCreate.disabled = true;
  ownerSetupBusy = true;
  const proposalError = document.querySelector('#proposal-error'); proposalError.textContent = '';
  ownerSetupNotice = '';
  let ownerCreated = false;
  try {
    const selectedModel = JSON.parse(proposalModel.value); const startingPrompt = document.querySelector('#proposal-prompt').value;
    if (currentProposal.workType === 'quick_request') {
      const record = await createQuickRequest(invoke, startingPrompt, selectedModel);
      ownerCreated = true;
      pendingPromptAction = { type: 'quick_request', id: record.task.id, ownerKey: `task:${record.task.id}`, sessionId: record.session.openCodeSessionId, model: selectedModel };
      document.querySelector('#pending-prompt-text').value = startingPrompt;
      const quickWorkspace = navigationData.workspaces.find((entry) => entry.id === record.task.workspaceId)
        || { id: record.task.workspaceId, name: 'Quick Requests', kind: 'quick_requests', status: 'active' };
      if (quickWorkspace) selectTask(record.task, quickWorkspace, navigationData);
      await showSession(record.session.openCodeSessionId);
      await refreshRequests();
    } else if (currentProposal.workType === 'task') {
      const workspaceId = currentProposal.workspace.id;
      const task = await createWorkspaceTask(
        invoke,
        workspaceId,
        selectedModel,
        currentProposal.task.name,
        currentProposal.task.intent,
        currentProposal.repositories.map((repository) => repository.repositoryId),
      );
      ownerCreated = true;
      if (!task.setupSessionId || !task.setupOperationId) throw new Error('Task setup session was not created.');
      const taskPromptAction = { type: 'task', id: task.id, ownerKey: `task:${task.id}`, sessionId: task.setupSessionId, operationId: task.setupOperationId, model: selectedModel, repositoryIds: currentProposal.repositories.map((repository) => repository.repositoryId) };
      const currentWorkspace = navigationData.workspaces.find((entry) => entry.id === task.workspaceId)
        || { ...currentProposal.workspace, status: 'active', kind: 'regular' };
      selectTask(task, currentWorkspace, navigationData);
      const data = await refreshNavigation();
      const workspace = data.workspaces.find((entry) => entry.id === task.workspaceId) || currentWorkspace;
      selectTask(task, workspace, data);
      await showSession(task.setupSessionId);
      await submitNewWorkStartingPrompt(invoke, taskPromptAction, startingPrompt);
      workspaceStatus.textContent = 'Task setup started. Follow setup status here and interact in the terminal.';
    } else {
      const initialized = await createInitializedWorkspace(
        invoke,
        currentProposal.workspace.name,
        selectedModel,
        currentProposal.workspace.intent || null,
      );
      ownerCreated = true;
      const workspacePromptAction = { type: 'workspace', ownerKey: `workspace:${initialized.workspace.id}`, sessionId: initialized.session.openCodeSessionId, model: selectedModel };
      selectWorkspace(initialized.workspace, navigationData);
      await showSession(initialized.session.openCodeSessionId);
      const data = await refreshNavigation();
      selectWorkspace(selectCreatedWorkspace(data, initialized.workspace), data);
      const repositories = new Map((window.repositoryCatalog || []).map((repository) => [repository.id, repository]));
      const attachmentFailures = [];
      for (const proposalRepository of currentProposal.repositories) {
        const repository = repositories.get(proposalRepository.repositoryId);
        if (!repository) {
          attachmentFailures.push(`${proposalRepository.repositoryId}: no longer in the repository catalog`);
          continue;
        }
        try {
          await attachRepository(invoke, initialized.workspace.id, repository.id, repository.repositoryPath, 'main');
        } catch (error) {
          attachmentFailures.push(`${repository.name}: ${String(error)}`);
        }
      }
      ownerSetupNotice = attachmentFailures.length
        ? `Workspace created, but repository setup needs attention: ${attachmentFailures.join('; ')}`
        : currentProposal.repositories.length ? 'Workspace and confirmed repositories are ready.' : 'Workspace created without repositories.';
      workspaceStatus.textContent = ownerSetupNotice;
      await refreshNavigation();
      await submitNewWorkStartingPrompt(invoke, workspacePromptAction, startingPrompt);
      workspaceStatus.textContent = `${ownerSetupNotice} Starting prompt submitted to the interactive terminal.`;
    }
    newWorkReview.hidden = true; currentProposal = null;
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
    if (ownerCreated) {
      // Creation already committed. Leave the owner selected and do not expose
      // a Create action that could make a duplicate owner after a later attach,
      // refresh, terminal-mount, or prompt-send failure.
      newWorkReview.hidden = true;
      currentProposal = null;
      newWorkDialog.close();
      workspaceStatus.textContent = formatWorkspaceError('Finish owner setup', error);
      pendingPromptAction = null;
    } else proposalError.textContent = formatWorkspaceError('Create work', error);
  }
  finally {
    ownerSetupBusy = false;
    syncPendingPrompt();
    proposalCreate.disabled = ownerCreated;
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
    await cleanupTerminal(invoke, sessionId);
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
  const ownerKey = keyForSessionOwner(selectedTask
    ? { owner_type: 'task', owner_id: selectedTask.id }
    : selectedWorkspace ? { owner_type: 'workspace', owner_id: selectedWorkspace.id } : null);
  if (selectedSessionByOwner.get(ownerKey) === sessionId) selectedSessionByOwner.delete(ownerKey);
  syncOwnerSessions();
  if (!sessionTabs.querySelector(`[data-owner-key="${CSS.escape(ownerKey || '')}"]:not([hidden])`)) {
    setSessionStatus('');
  }
}
document.querySelector('#scan-repositories')?.addEventListener('click', async () => {
  const path = document.querySelector('#scan-path').value.trim();
  workspaceStatus.textContent = 'Scanning repositories…';
  try { const result = await scanRepositories(invoke, path ? [path] : []); workspaceStatus.textContent = result.errors?.length ? `Scan completed with issues: ${result.errors.join('; ')}` : `Found ${result.repositories.length} repository entr${result.repositories.length === 1 ? 'y' : 'ies'}.`; await refreshCatalog(); } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Scan', error); }
});
document.querySelector('#attach-repository')?.addEventListener('click', async () => {
  if (!selectedWorkspace || !selectedRepository) { workspaceStatus.textContent = 'Select a workspace and a catalog repository first.'; return; }
  workspaceStatus.textContent = 'Attaching repository…';
  try {
    await attachRepository(invoke, selectedWorkspace.id, selectedRepository.id, selectedRepository.repositoryPath, 'main');
    workspaceStatus.textContent = `Attached ${selectedRepository.name}.`;
    await refreshNavigation();
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Attach', error); }
});
async function refreshCatalog() {
   const repositories = await listRepositoryCatalog(invoke);
    window.repositoryCatalog = repositories;
    if (selectedWorkspace) renderAttachedRepositories(selectedWorkspace.id, navigationData);
   if (!repositoryList) return repositories;
  repositoryList.replaceChildren(...(repositories.length ? repositories.map((repository) => {
    const item = document.createElement('li'); const button = document.createElement('button'); button.type = 'button'; button.textContent = repository.name; button.title = repository.repositoryPath;
    button.addEventListener('click', () => { selectedRepository = repository; repositoryList.querySelectorAll('button').forEach((entry) => entry.classList.remove('selected')); button.classList.add('selected'); }); item.append(button); return item;
  }) : [Object.assign(document.createElement('li'), { className: 'placeholder', textContent: 'No catalog entries' })]));
}
document.querySelector('#workspace-session-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!modelsReady) { workspaceStatus.textContent = 'Models are still loading; try again shortly.'; return; }
  if (!selectedWorkspace) { workspaceStatus.textContent = 'Select an active workspace first.'; return; }
  const submitButton = document.querySelector('#workspace-session-submit'); submitButton.disabled = true; workspaceStatus.textContent = 'Starting workspace session…';
   try { const selectedModel = JSON.parse(model.value); const record = await createWorkspaceSession(invoke, selectedWorkspace.id, document.querySelector('#workspace-prompt').value, selectedModel); await showSession(record.openCodeSessionId); workspaceStatus.textContent = 'Workspace session started.'; } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Workspace session', error); } finally { submitButton.disabled = !modelsReady || selectedWorkspace.status !== 'active'; }
});
document.querySelector('#show-history').addEventListener('click', () => {
  void refreshRequests(true).catch((error) => { errorMessage.textContent = String(error); });
});

async function refreshRequests(history = false) {
  const records = await listQuickRequests(invoke, history);
  list.replaceChildren(...(records.length ? records.map((record) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = record.task.name;
    button.addEventListener('click', async () => {
      const restored = await restoreQuickRequest(invoke, record.task.id);
      const runtime = await terminalRuntime;
       await showSession(restored.session.openCodeSessionId);
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'quiet-button';
    dismiss.textContent = 'Dismiss';
     dismiss.addEventListener('click', async () => {
      await dismissQuickRequest(invoke, record.task.id);
      await refreshRequests(history);
     });
     const promote = document.createElement('button');
     promote.type = 'button';
     promote.className = 'quiet-button';
     promote.textContent = 'Promote';
     promote.addEventListener('click', async () => {
       const target = selectedWorkspace?.status === 'active' && selectedWorkspace.kind === 'regular'
         ? selectedWorkspace.id
         : null;
       const entered = target ? null : window.prompt('Enter a workspace ID, or new: Workspace name');
       const newName = entered?.startsWith('new:') ? entered.slice(4).trim() : null;
       const targetId = target || (entered && !entered.startsWith('new:') ? entered.trim() : null);
       try {
         await promoteQuickRequest(invoke, record.task.id, targetId, newName);
         workspaceStatus.textContent = 'Quick Request promoted; its identity and history were preserved.';
         await refreshRequests(history);
         await refreshNavigation();
       } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Promote Quick Request', error); }
     });
      const sessionState = record.session?.lastKnownStatus;
      const retryable = sessionState === 'failed' || record.session?.reconciliationUncertain === true;
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'quiet-button'; retry.textContent = 'Retry';
      retry.hidden = !retryable;
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        workspaceStatus.textContent = 'Retrying session…';
        try {
          const selectedModel = JSON.parse(model.value);
          await retryQuickRequestPrompt(invoke, record.task.id, selectedModel);
          workspaceStatus.textContent = 'Session retry started.';
          await refreshRequests(history);
        } catch (error) {
          retry.disabled = false;
          workspaceStatus.textContent = formatWorkspaceError('Retry session', error);
        }
      });
      item.append(button, dismiss, promote, retry);
    return item;
  }) : [Object.assign(document.createElement('li'), { textContent: 'None yet' })]));
}

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
void refreshCatalog().catch((error) => { workspaceStatus.textContent = `Catalog unavailable: ${String(error)}`; });

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
