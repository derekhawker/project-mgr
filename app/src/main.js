import { invokeCommand } from './command-contract.js';
import { listen } from '@tauri-apps/api/event';
import { loadApplicationShell } from './shell.js';
import { listQuickRequests, restoreQuickRequest, dismissQuickRequest, retryQuickRequestPrompt, loadWorkspaceNavigation, createWorkspace, createWorkspaceTask, startTaskSetupPrompt, getTaskSetupStatus, cancelTaskSetup, resumeTaskSetup, scanRepositories, listRepositoryCatalog, attachRepository, createWorkspaceSession, formatWorkspaceError, workspaceNavigationModel, selectCreatedWorkspace, listPendingInputs, listAllPendingInputs, getSessionStatus, reconcileSession, createTaskSession, sessionStatusLabel, completeTask, listTaskCleanupJobs, retryTaskCleanup, completeWorkspace, reactivateWorkspace, promoteQuickRequest, sessionTabAttributes, terminalAccessibilityAttributes, controlErrorAttributes } from './shell.js';
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
      if (sessionStatus) sessionStatus.textContent = text;
    },
  }).start())
  .catch((error) => {
    console.error(error);
    const message = `Terminal startup failed: ${String(error)}`;
    if (sessionStatus) sessionStatus.textContent = message;
    document.querySelectorAll('button').forEach((button) => {
      if (button.closest('#quick-request-form, #workspace-session-form, #new-task-session')) button.disabled = true;
    });
    return null;
  });

void listen('session-recovery-error', ({ payload }) => {
  const text = `Session recovery failed (${payload?.sessionId || 'unknown'}): ${payload?.message || 'unknown error'}`;
  if (commandResult) commandResult.textContent = text;
  if (sessionStatus) sessionStatus.textContent = text;
});
void listen('startup-recovery-error', ({ payload }) => {
  if (commandResult) commandResult.textContent = `Startup recovery failed: ${payload?.message || 'unknown error'}`;
});
void listen('cleanup-recovery-error', ({ payload }) => {
  showCleanupError('cleanup-recovery-error', payload, commandResult);
});
void listen('cleanup-job-error', ({ payload }) => {
  showCleanupError('cleanup-job-error', payload, commandResult);
});
void listen('cleanup-worker-error', ({ payload }) => {
  showCleanupError('cleanup-worker-error', payload, commandResult);
});

const form = document.querySelector('#quick-request-form');
const prompt = document.querySelector('#quick-prompt');
const model = document.querySelector('#quick-model');
const submit = document.querySelector('#quick-submit');
const errorMessage = document.querySelector('#quick-error');
const list = document.querySelector('#quick-request-list');
const terminalViews = document.querySelector('#terminal-views');
const workspaceList = document.querySelector('#workspace-list');
const workspaceTitle = document.querySelector('#quick-title');
const workspaceDescription = document.querySelector('#workspace-description');
const workspaceStatus = document.querySelector('#workspace-status');
const repositoryList = document.querySelector('#repository-list');
let selectedWorkspace = null;
let selectedTask = null;
let selectedRepository = null;
let navigationData = { workspaces: [], tasks: [] };
const sessionTabs = document.querySelector('#session-tabs');
const sessionStatus = document.querySelector('#session-status');
const pendingInputs = document.querySelector('#pending-inputs');
const openSessions = new Set();
let modelsReady = false;

function setModelControls(ready) {
  modelsReady = ready;
  model.disabled = !ready;
  submit.disabled = !ready;
  document.querySelector('#workspace-session-submit').disabled = !ready || !selectedWorkspace || selectedWorkspace.status !== 'active';
  model.setAttribute('aria-busy', String(!ready));
}

setModelControls(false);

async function showSession(sessionId) {
  const runtime = await terminalRuntime;
  if (!runtime) throw new Error('Terminal runtime is unavailable; see the startup error above.');
  // Rust resolves the persisted id/directory and owns PTY attachment first;
  // this is intentionally before creating the xterm surface.
  await invokeCommand(invoke, 'opencode_session_restore', { sessionId });
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
      tab.type = 'button'; tab.dataset.sessionId = sessionId; tab.textContent = sessionId;
      Object.entries(sessionTabAttributes(sessionId, true)).forEach(([name, value]) => tab.setAttribute(name, value));
     tab.setAttribute('aria-label', `OpenCode session ${sessionId}`);
     tab.setAttribute('aria-selected', 'true');
     tab.addEventListener('click', () => { runtime.select(sessionId); void refreshSessionEvidence(sessionId); });
    sessionTabs.append(tab);
  } else runtime.select(sessionId);
  terminalViews.querySelectorAll('.terminal-surface').forEach((view) => { view.hidden = view !== terminalContainer; });
   sessionTabs.querySelectorAll('button').forEach((tab) => {
     const selected = tab.dataset.sessionId === sessionId;
     tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
   });
  await refreshSessionEvidence(sessionId);
}

sessionTabs.addEventListener('keydown', (event) => {
  const tabs = [...sessionTabs.querySelectorAll('[role="tab"]')];
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
    sessionStatus.textContent = sessionStatusLabel(reconciliation?.status || status);
    pendingInputs.replaceChildren(...[...(pending.permissions || []), ...(pending.forms || [])].map((item) => Object.assign(document.createElement('li'), { textContent: `Input required · ${item.id || item.requestID || 'request'}` })));
  } catch (error) { sessionStatus.textContent = `Session status unavailable: ${String(error)}`; }
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
    commandResult.textContent = text;
  }
}

function renderNavigation(data) {
  navigationData = data;
  workspaceList.setAttribute('aria-busy', 'false');
  const regular = workspaceNavigationModel(data).filter(({ workspace }) => workspace.status === 'active');
  const renderTasks = ({ workspace, tasks }, history = false) => tasks.filter((task) => history || task.status === 'active').map((task) => {
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
  const renderWorkspace = ({ workspace, tasks }, history = false) => {
    const item = document.createElement('li');
     const button = document.createElement('button');
    button.type = 'button';
    button.textContent = history ? `${workspace.name} · completed` : workspace.name;
    button.className = `${history ? 'history-item ' : ''}${selectedWorkspace?.id === workspace.id ? 'selected' : ''}`.trim();
    button.addEventListener('click', () => selectWorkspace(workspace, data));
    item.append(button);
     item.append(...renderTasks({ workspace, tasks }, history));
    return item;
  };
  workspaceList.replaceChildren(...(regular.length ? regular.map((entry) => renderWorkspace(entry)) : [Object.assign(document.createElement('li'), { className: 'placeholder', textContent: 'No workspaces yet' })]));
  const completed = workspaceNavigationModel(data).filter(({ workspace }) => workspace.status === 'completed');
  document.querySelector('#workspace-history-list').replaceChildren(...(completed.length ? completed.map((entry) => renderWorkspace(entry, true)) : [Object.assign(document.createElement('li'), { className: 'placeholder', textContent: 'None yet' })]));
  const completedTasks = workspaceNavigationModel(data).flatMap((entry) => entry.tasks.filter((task) => task.status === 'completed').map((task) => ({ task, workspace: entry.workspace })));
  document.querySelector('#task-history-list').replaceChildren(...(completedTasks.length ? completedTasks.map(({ task, workspace }) => { const item = document.createElement('li'); const button = document.createElement('button'); button.type = 'button'; button.textContent = `${task.name} · completed`; button.addEventListener('click', () => selectTask(task, workspace, data)); item.append(button); return item; }) : [Object.assign(document.createElement('li'), { className: 'placeholder', textContent: 'None yet' })]));
}

function selectWorkspace(workspace, data = navigationData) {
  selectedWorkspace = workspace;
  selectedTask = null;
  workspaceTitle.textContent = workspace.name;
  workspaceDescription.textContent = `${workspace.description || 'Workspace ready for planning and tasks.'} · ${workspace.status}`;
  const disabled = workspace.status !== 'active';
  document.querySelector('#new-task').disabled = disabled;
  document.querySelector('#attach-repository').disabled = disabled;
  document.querySelector('#workspace-session-submit').disabled = disabled || !modelsReady;
  document.querySelector('#complete-workspace').disabled = disabled;
  document.querySelector('#reactivate-workspace').disabled = workspace.status !== 'completed';
  setTaskSetupControls(null);
  renderNavigation(data);
}

function selectTask(task, workspace, data = navigationData) {
  selectedWorkspace = workspace;
  selectedTask = task;
  workspaceTitle.textContent = task.name;
  workspaceDescription.textContent = `${task.description || 'Task'} · ${task.status}`;
  document.querySelector('#new-task').disabled = workspace.status !== 'active';
  document.querySelector('#attach-repository').disabled = workspace.status !== 'active';
  document.querySelector('#workspace-session-submit').disabled = workspace.status !== 'active' || !modelsReady;
  document.querySelector('#complete-workspace').disabled = workspace.status !== 'active';
  document.querySelector('#reactivate-workspace').disabled = workspace.status !== 'completed';
  setTaskSetupControls(task);
  renderNavigation(data);
}

function setTaskSetupControls(task) {
  const hasTask = Boolean(task);
  document.querySelector('#task-setup-cancel').disabled = !hasTask || task.setupStatus === 'ready';
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
  if (!selectedTask) return null;
  const status = await getTaskSetupStatus(invoke, selectedTask.id);
  selectedTask = status.task;
  workspaceStatus.textContent = `Setup ${status.task.setupStatus}.`;
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
    await startTaskSetupPrompt(invoke, task.id, task.setupOperationId, status.session.openCodeSessionId, selectedModel);
    await refreshTaskSetup();
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Resume setup', error); }
});

async function refreshNavigation() { const data = await loadWorkspaceNavigation(invoke); renderNavigation(data); return data; }
document.querySelector('#new-workspace').addEventListener('click', async () => {
  const name = window.prompt('Workspace name'); if (!name?.trim()) return;
  try { const createdWorkspace = await createWorkspace(invoke, name.trim()); const data = await refreshNavigation(); selectWorkspace(selectCreatedWorkspace(data, createdWorkspace), data); } catch (error) { errorMessage.textContent = String(error); }
});
document.querySelector('#new-task').addEventListener('click', async () => {
  if (!selectedWorkspace) { workspaceStatus.textContent = 'Select a workspace first.'; return; }
  if (selectedWorkspace.status !== 'active') { workspaceStatus.textContent = 'Completed workspaces cannot receive new tasks.'; return; }
  const value = window.prompt(`Task prompt for ${selectedWorkspace.name}`);
  if (!value?.trim()) return;
  const button = document.querySelector('#new-task');
  button.disabled = true;
  workspaceStatus.textContent = 'Creating task…';
  try {
     const selectedModel = JSON.parse(model.value);
     const task = await createWorkspaceTask(invoke, selectedWorkspace.id, value.trim(), selectedModel);
     const data = await loadWorkspaceNavigation(invoke);
    const workspace = data.workspaces.find((entry) => entry.id === task.workspaceId) || selectedWorkspace;
    selectTask(task, workspace, data);
     workspaceStatus.textContent = `Setting up ${task.name}…`;
     const runtime = await terminalRuntime;
     // The task command owns the PTY; attachExisting is idempotent and makes
     // the setup conversation visible before its first prompt is sent.
     const setupSession = (await getTaskSetupStatus(invoke, task.id))?.session;
      if (setupSession) await showSession(setupSession.openCodeSessionId);
      await startTaskSetupPrompt(invoke, task.id, task.setupOperationId, setupSession.openCodeSessionId, selectedModel);
     const status = await getTaskSetupStatus(invoke, task.id);
     const repositories = status.repositories || [];
     workspaceStatus.textContent = repositories.length
       ? `Setup ${status.task.setupStatus}: ${repositories.map((entry) => `${entry.repositoryId} · ${entry.setupStatus}`).join(', ')}`
       : `Setup ${status.task.setupStatus}. OpenCode is selecting repositories.`;
  } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Create task', error); }
  finally { button.disabled = selectedWorkspace?.status !== 'active'; }
});
document.querySelector('#scan-repositories').addEventListener('click', async () => {
  const path = document.querySelector('#scan-path').value.trim();
  workspaceStatus.textContent = 'Scanning repositories…';
  try { const result = await scanRepositories(invoke, path ? [path] : []); workspaceStatus.textContent = result.errors?.length ? `Scan completed with issues: ${result.errors.join('; ')}` : `Found ${result.repositories.length} repository entr${result.repositories.length === 1 ? 'y' : 'ies'}.`; await refreshCatalog(); } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Scan', error); }
});
document.querySelector('#attach-repository').addEventListener('click', async () => {
  if (!selectedWorkspace || !selectedRepository) { workspaceStatus.textContent = 'Select a workspace and a catalog repository first.'; return; }
  workspaceStatus.textContent = 'Attaching repository…';
  try { await attachRepository(invoke, selectedWorkspace.id, selectedRepository.id, selectedRepository.repositoryPath, 'main'); workspaceStatus.textContent = `Attached ${selectedRepository.name}.`; } catch (error) { workspaceStatus.textContent = formatWorkspaceError('Attach', error); }
});
async function refreshCatalog() {
  const repositories = await listRepositoryCatalog(invoke);
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
  onReady: () => setModelControls(true),
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
