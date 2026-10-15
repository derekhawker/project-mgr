import { invokeCommand } from './command-contract.js';
export function formatShellResponse(info) {
  if (
    !info ||
    typeof info.appName !== 'string' ||
    typeof info.version !== 'string' ||
    typeof info.status !== 'string' ||
    typeof info.message !== 'string'
  ) {
    throw new TypeError('The Rust core returned an invalid application shell response.');
  }

  return `${info.appName} · ${info.status} · ${info.message}`;
}

export async function loadApplicationShell({
  invoke,
  connectionStatus,
  connectionIndicator,
  commandResult,
  appVersion,
}) {
  try {
    const info = await invokeCommand(invoke, 'app_shell_info');
    commandResult.textContent = formatShellResponse(info);
    appVersion.textContent = `Version ${info.version}`;
    if (info.status === 'error') {
      connectionStatus.textContent = 'Rust core connected; management storage unavailable';
      connectionIndicator.classList.add('has-error');
      return;
    }
    connectionStatus.textContent = 'Connected to the Rust core';
    connectionIndicator.classList.add('is-connected');
  } catch (error) {
    connectionStatus.textContent = 'Could not connect to the Rust core';
    commandResult.textContent = String(error);
    connectionIndicator.classList.add('has-error');
  }
}

// Kept as a small adapter so the command contract is testable without making
// the shell start OpenCode during ordinary application startup.
export function checkOpenCodeRuntime(invoke) {
  return invokeCommand(invoke, 'opencode_runtime_info');
}

export function createSession(invoke, { title, directory, model }) {
  return invokeCommand(invoke, 'opencode_session_create', { title, directory, model });
}

export function bindSessionModel(invoke, sessionId, model) {
  return invokeCommand(invoke, 'opencode_session_model', { sessionId, model });
}

export function sendInitialPrompt(invoke, sessionId, prompt, model) {
  return invokeCommand(invoke, 'opencode_session_prompt', { sessionId, prompt, model });
}

export function replyToPermission(invoke, sessionId, requestId, decision, message = null) {
  return invokeCommand(invoke, 'opencode_permission_reply', {
    sessionId,
    requestId,
    decision,
    message,
  });
}

export function replyToForm(invoke, sessionId, requestId, answer) {
  return invokeCommand(invoke, 'opencode_form_reply', { sessionId, requestId, answer });
}

export function cancelForm(invoke, sessionId, requestId) {
  return invokeCommand(invoke, 'opencode_form_cancel', { sessionId, requestId });
}

// Session adapters keep the WebView payload deliberately small and explicit.
// Rust remains responsible for validation, authentication, and raw OpenCode
// evidence; rejected invocations are intentionally returned to the caller.
export function getSessionHistory(invoke, sessionId, { order = 'asc', limit = 500 } = {}) {
  return invokeCommand(invoke, 'opencode_session_history', { sessionId, order, limit });
}

export function getSessionStatus(invoke, sessionId) {
  return invokeCommand(invoke, 'opencode_session_status', { sessionId });
}

export function reconcileSession(invoke, sessionId, cursor = null) {
  return invokeCommand(invoke, 'opencode_session_reconcile', { sessionId, cursor });
}

export function listPendingInputs(invoke, sessionId) {
  return invokeCommand(invoke, 'opencode_pending_inputs', { sessionId });
}

export function listSessionPendingInputs(invoke, sessionId) {
  return invokeCommand(invoke, 'opencode_session_pending_inputs', { sessionId });
}

export function listAllPendingInputs(invoke) {
  return invokeCommand(invoke, 'opencode_pending_inputs_all');
}

export const SESSION_STATUS_LABELS = Object.freeze({
  starting: 'Starting', running: 'Running', waitingForInput: 'Waiting for input',
  readyForReview: 'Ready for review', reconnecting: 'Reconnecting', unknown: 'Unknown', failed: 'Failed',
});

export function sessionStatusLabel(status) {
  const key = typeof status === 'string' ? status : status?.applicationStatus;
  return SESSION_STATUS_LABELS[key] || 'Unknown';
}

export function createTaskSession(invoke, taskId, prompt, model) {
  return invokeCommand(invoke, 'task_session_create', { taskId, prompt, model });
}

// Reattachment is observation only. In particular, restoring a conversation
// must never reuse the initial-prompt command.
export async function restoreSession(invoke, sessionId, cursor = null) {
  const [history, status, reconciliation] = await Promise.all([
    getSessionHistory(invoke, sessionId),
    getSessionStatus(invoke, sessionId),
    reconcileSession(invoke, sessionId, cursor),
  ]);
  return { history, status, reconciliation };
}

export function attachTerminal(invoke, sessionId, directory) {
  return invokeCommand(invoke, 'opencode_terminal_attach', { sessionId, directory });
}

export function startTerminal(invoke, sessionId, directory) {
  return invokeCommand(invoke, 'opencode_terminal_start', { sessionId, directory });
}

export function writeTerminal(invoke, sessionId, data) {
  return invokeCommand(invoke, 'opencode_terminal_write', { sessionId, data });
}

export function resizeTerminal(invoke, sessionId, cols, rows) {
  return invokeCommand(invoke, 'opencode_terminal_resize', { sessionId, cols, rows });
}

export function detachTerminal(invoke, sessionId) {
  return invokeCommand(invoke, 'opencode_terminal_detach', { sessionId });
}

export function cleanupTerminal(invoke, sessionId) {
  return invokeCommand(invoke, 'opencode_terminal_cleanup', { sessionId });
}

export function createQuickRequest(invoke, prompt, model) {
  return invokeCommand(invoke, 'quick_request_create', { prompt, model });
}

export function startQuickRequestPrompt(invoke, requestId, model, prompt = undefined) {
  const payload = { requestId, model };
  if (prompt !== undefined) payload.prompt = prompt;
  return invokeCommand(invoke, 'quick_request_start_prompt', payload);
}

// Keep the submit lifecycle in one testable place. In particular, preserve the
// prompt and existing UI state until the runtime has attached, shown the exact
// session, and accepted the initial prompt. Only the prompt field is cleared on
// full success; a failed step leaves the user's text available for recovery.
export async function submitQuickRequestFlow({
  invoke,
  promptInput,
  promptText,
  model,
  waitForTerminal,
  showSession,
  refreshRequests,
}) {
  await waitForTerminal();
  const record = await createQuickRequest(invoke, promptText, model);
  const sessionId = record.session?.openCodeSessionId;
  if (!sessionId) throw new Error('Quick Request creation returned no session ID.');
  await showSession(sessionId);
  await startQuickRequestPrompt(invoke, record.task.id, model);
  promptInput.value = '';
  await refreshRequests();
  return record;
}

export function retryQuickRequestPrompt(invoke, requestId, model) {
  return invokeCommand(invoke, 'quick_request_retry_prompt', { requestId, model });
}

export function sessionTabAttributes(sessionId, selected) {
  return { id: `session-tab-${sessionId}`, role: 'tab', 'aria-controls': `terminal-${sessionId}`, 'aria-selected': String(selected), tabindex: selected ? '0' : '-1' };
}

export function terminalAccessibilityAttributes(sessionId) {
  return { role: 'tabpanel', 'aria-labelledby': `session-tab-${sessionId}`, 'aria-label': `OpenCode terminal for session ${sessionId}`, 'aria-describedby': 'session-status', tabindex: '0' };
}

export function controlErrorAttributes(errorId) {
  return errorId ? { 'aria-describedby': errorId, 'aria-invalid': 'true' } : {};
}

export function listAvailableModels(invoke) {
  return invokeCommand(invoke, 'opencode_models');
}

export function getDefaultModel(invoke) {
  return invokeCommand(invoke, 'opencode_model_default');
}

// This is the production model-loader seam used by the selector.  Keeping the
// fetch, empty-catalog policy, and error transition together prevents a
// healthy-looking selector from being left enabled after a CLI/API failure.
export async function loadModelSelector(invoke, { onModels, onError }) {
  try {
    const models = await listAvailableModels(invoke);
    if (!models.length) throw new Error('No enabled OpenCode models are available.');
    onModels(models);
    return models;
  } catch (error) {
    onError(error);
    throw error;
  }
}

export function populateModelSelector(select, models, createOption = (entry) => {
  const option = document.createElement('option');
  const providerId = entry.providerId || entry.providerID;
  option.value = JSON.stringify({ providerId, id: entry.id });
  option.textContent = entry.name || `${providerId}/${entry.id}`;
  return option;
}) {
  select.replaceChildren(...models.map(createOption));
}

export function followUpQuickRequest(invoke, requestId, data) {
  return invokeCommand(invoke, 'quick_request_follow_up', { requestId, data });
}

export function restoreQuickRequest(invoke, requestId) {
  return invokeCommand(invoke, 'quick_request_restore', { requestId });
}

export function listQuickRequests(invoke, history = false) {
  return invokeCommand(invoke, 'quick_request_list', { request: { history } });
}

export function dismissQuickRequest(invoke, requestId) {
  return invokeCommand(invoke, 'quick_request_dismiss', { requestId });
}

export function expireQuickRequest(invoke, requestId) {
  return invokeCommand(invoke, 'quick_request_expire', { requestId });
}

export function loadWorkspaceNavigation(invoke) {
  return invokeCommand(invoke, 'workspace_navigation');
}

export function startNewWorkProposal(invoke, model) {
  return invokeCommand(invoke, 'new_work_proposal_start', { model });
}

export function runNewWorkProposal(invoke, sessionId, originalPrompt, preferredWorkspaceId = undefined) {
  const payload = { sessionId, originalPrompt };
  if (preferredWorkspaceId !== undefined) payload.preferredWorkspaceId = preferredWorkspaceId;
  return invokeCommand(invoke, 'new_work_proposal_run', payload);
}

export function readNewWorkProposal(invoke, sessionId, preferredWorkspaceId = undefined) {
  const payload = { sessionId };
  if (preferredWorkspaceId !== undefined) payload.preferredWorkspaceId = preferredWorkspaceId;
  return invokeCommand(invoke, 'new_work_proposal_read', payload);
}

export function closeNewWorkProposal(invoke, sessionId) {
  return invokeCommand(invoke, 'new_work_proposal_close', { sessionId });
}

export function workspaceTasks(navigation, workspaceId) {
  return (navigation?.tasks || []).filter((task) => task.workspaceId === workspaceId);
}

export function trackedSessionForOwner(navigation, ownerType, ownerId, preferredId, openSessionIds = []) {
  const tracked = (navigation?.sessions || []).filter((session) =>
    session.owner?.owner_type === ownerType && session.owner?.owner_id === ownerId);
  return tracked.find((session) => session.openCodeSessionId === preferredId)
    || [...tracked].reverse().find((session) => openSessionIds.includes(session.openCodeSessionId))
    || tracked.at(-1)
    || null;
}

export function workspaceNavigationModel(navigation) {
  return (navigation?.workspaces || [])
    .filter((workspace) => workspace.kind === 'regular')
    .map((workspace) => ({ workspace, tasks: workspaceTasks(navigation, workspace.id) }));
}

export function selectCreatedWorkspace(navigation, createdWorkspace) {
  return navigation?.workspaces?.find((workspace) => workspace.id === createdWorkspace?.id)
    || createdWorkspace;
}

// Navigation keeps completed tasks in the same Workspace -> Task hierarchy;
// callers can use this lookup for selection without treating history as text.
export function selectWorkspaceTask(navigation, taskId) {
  const task = navigation?.tasks?.find((entry) => entry.id === taskId);
  if (!task) return null;
  const workspace = navigation.workspaces?.find((entry) => entry.id === task.workspaceId);
  return workspace ? { task, workspace } : null;
}

export function createWorkspace(invoke, name, description = null) {
  return invokeCommand(invoke, 'workspace_create', { name, description });
}

export function createInitializedWorkspace(invoke, name, model, description = null) {
  return invokeCommand(invoke, 'workspace_create_initialized', { name, description, model });
}

export function completeWorkspace(invoke, workspaceId) {
  return invokeCommand(invoke, 'workspace_complete', { workspaceId });
}

export function reactivateWorkspace(invoke, workspaceId) {
  return invokeCommand(invoke, 'workspace_reactivate', { workspaceId });
}

export function promoteQuickRequest(invoke, requestId, targetWorkspaceId = null, newWorkspaceName = null, targetSlug = null) {
  return invokeCommand(invoke, 'quick_request_promote', {
    requestId,
    targetWorkspaceId,
    newWorkspaceName,
    targetSlug,
  });
}

export function createWorkspaceTask(invoke, workspaceId, model, name, description = undefined, repositoryIds = undefined) {
  const payload = { workspaceId, model, name };
  if (description !== undefined) payload.description = description;
  if (repositoryIds !== undefined) payload.repositoryIds = repositoryIds;
  return invokeCommand(invoke, 'task_create', payload);
}

export function completeTask(invoke, taskId) {
  return invokeCommand(invoke, 'task_complete', { taskId });
}

export function listTaskCleanupJobs(invoke, taskId) {
  return invokeCommand(invoke, 'task_cleanup_jobs', { taskId });
}

export function retryTaskCleanup(invoke, taskId) {
  return invokeCommand(invoke, 'task_cleanup_retry', { taskId });
}

export function startTaskSetupPrompt(invoke, taskId, operationId, sessionId, model, startingPrompt, repositoryIds = undefined) {
  const request = { taskId, operationId, sessionId, model };
  request.startingPrompt = startingPrompt;
  if (repositoryIds !== undefined) request.repositoryIds = repositoryIds;
  return invokeCommand(invoke, 'task_setup_start_prompt', {
    ...request,
  });
}

export function submitNewWorkStartingPrompt(invoke, action, prompt) {
  if (!prompt?.trim()) throw new Error('Enter a starting prompt first.');
  if (action?.type === 'workspace') {
    return sendInitialPrompt(invoke, action.sessionId, prompt, action.model);
  }
  if (action?.type === 'task') {
    return startTaskSetupPrompt(
      invoke,
      action.id,
      action.operationId,
      action.sessionId,
      action.model,
      prompt,
      action.repositoryIds,
    );
  }
  if (action?.type === 'quick_request') {
    return startQuickRequestPrompt(invoke, action.id, action.model, prompt);
  }
  throw new Error('The pending starting prompt has no valid owner.');
}

export function getTaskSetupStatus(invoke, taskId) {
  return invokeCommand(invoke, 'task_setup_status', { taskId });
}

export function formatTaskSetupStatus(status) {
  const setupStatus = status?.task?.setupStatus || 'unknown';
  const items = (status?.repositories || []).map((item) => {
    const parts = [item.repositoryId, item.setupStatus];
    if (item.branch) parts.push(`branch ${item.branch}`);
    if (item.worktreePath) parts.push(item.worktreePath);
    if (item.errorDetail) parts.push(item.errorDetail);
    return parts.join(' · ');
  });
  return [`Setup ${setupStatus}.`, ...items].join(' ');
}

export function cancelTaskSetup(invoke, taskId) {
  return invokeCommand(invoke, 'task_setup_cancel', { taskId });
}

export function resumeTaskSetup(invoke, taskId, operationId, sessionId) {
  return invokeCommand(invoke, 'task_setup_resume', {
    taskId, operationId, sessionId,
  });
}

export function listTaskRegistrationResults(invoke, taskId) {
  return invokeCommand(invoke, 'task_registration_results', { taskId });
}

export function submitTaskRegistration(invoke, report) {
  return invokeCommand(invoke, 'task_registration_report', report);
}

export function scanRepositories(invoke, paths, purposeProposals = null) {
  return invokeCommand(invoke, 'repository_scan', { paths, purposeProposals });
}

export function listRepositoryCatalog(invoke) {
  return invokeCommand(invoke, 'repository_catalog');
}

export function formatWorkspaceError(action, error) {
  return `${action} failed: ${String(error)}`;
}

export function attachRepository(invoke, workspaceId, repositoryId, checkoutPath, branch, checkoutMode = 'existing') {
  return invokeCommand(invoke, 'repository_attach', { workspaceId, repositoryId, checkoutPath, branch, checkoutMode });
}

export function createWorkspaceSession(invoke, workspaceId, prompt, model) {
  return invokeCommand(invoke, 'workspace_session_create', { workspaceId, prompt, model });
}
