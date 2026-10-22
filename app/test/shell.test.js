import assert from 'node:assert/strict';
import test from 'node:test';
import { repositoryDirectoryPage } from './command-fixtures.js';
import {
  checkOpenCodeRuntime,
  createSession,
  bindSessionModel,
  sendInitialPrompt,
  replyToPermission,
  replyToForm,
  cancelForm,
  formatShellResponse,
  getSessionHistory,
  getSessionStatus,
  loadApplicationShell,
  reconcileSession,
  attachTerminal,
  startTerminal,
  writeTerminal,
  resizeTerminal,
  detachTerminal,
  cleanupTerminal,
  restoreSession,
  createQuickRequest,
  resolveQuickRequestDirectory,
  submitQuickRequestFlow,
  submitResolvedQuickRequestFlow,
  startQuickRequestPrompt,
  listAvailableModels,
  getDefaultModel,
  followUpQuickRequest,
  restoreQuickRequest,
  listQuickRequests,
  dismissQuickRequest,
  deleteQuickRequest,
  expireQuickRequest,
  loadWorkspaceNavigation,
  startNewWorkProposal,
  runNewWorkProposal,
  readNewWorkProposal,
  closeNewWorkProposal,
  selectWorkspaceTask,
  taskWorkspaceOptions,
  preferredTaskWorkspaceId,
  createWorkspace,
  createInitializedWorkspace,
  createWorkspaceTask,
  submitNewWorkStartingPrompt,
  getTaskSetupStatus,
  formatTaskSetupStatus,
  taskSetupStatusNotice,
  cancelTaskSetup,
  resumeTaskSetup,
  retryTaskSetup,
  scanRepositories,
  addRepositoryDirectories,
  listRepositoryCatalog,
  loadRepositoryDirectoryPage,
  setRepositoryEnabled,
  formatWorkspaceError,
  attachRepository,
  createWorkspaceSession,
  listPendingInputs,
  createTaskSession,
  workspaceTasks,
  workspaceNavigationModel,
  selectCreatedWorkspace,
  trackedSessionForOwner,
  sessionStatusLabel,
  completeTask,
  listTaskCleanupJobs,
  retryTaskCleanup,
  completeWorkspace,
  reactivateWorkspace,
  promoteQuickRequest,
  retryQuickRequestPrompt,
  sessionTabAttributes,
  terminalAccessibilityAttributes,
  controlErrorAttributes,
  createKeyedSingleFlight,
  workspaceProposalRepositoryLocations,
  workspaceStartingPrompt,
  shouldSubmitWorkspaceStartingPrompt,
  workspaceReviewDetails,
} from '../src/shell.js';
import { resultForCommand, completedTask, history, status, reconciliation, task, session, newWorkProposal } from './command-fixtures.js';

test('concurrent requests to show one session share a single restore and tab creation', async () => {
  let starts = 0;
  let release;
  const show = createKeyedSingleFlight(async (sessionId) => {
    starts += 1;
    await new Promise((resolve) => { release = resolve; });
    return `shown:${sessionId}`;
  });
  const first = show('ses-one');
  const second = show('ses-one');
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(starts, 1);
  release();
  assert.equal(await first, 'shown:ses-one');
  const afterCompletion = show('ses-one');
  await Promise.resolve();
  release();
  assert.equal(await afterCompletion, 'shown:ses-one');
  assert.equal(starts, 2);
});

test('workspace review lists repository locations and uses the proposal prompt as its starting prompt', () => {
  assert.deepEqual(
    workspaceProposalRepositoryLocations(
      [{ repositoryId: 'repo-a', reason: 'matches the request' }],
      [{ id: 'repo-a', name: 'Alpha', repositoryPath: '/work/alpha' }],
    ),
    [{ name: 'Alpha', path: '/work/alpha' }],
  );
  assert.equal(workspaceStartingPrompt({ startingPrompt: 'Revised starting text' }), 'Revised starting text');
  assert.equal(shouldSubmitWorkspaceStartingPrompt('  '), false);
  assert.equal(shouldSubmitWorkspaceStartingPrompt('A starting prompt'), true);
  assert.equal(workspaceStartingPrompt({}), '');
  assert.deepEqual(workspaceReviewDetails({
    workspace: { name: 'Edited proposal name' },
    setupPlan: { workspaceHome: '/home/user/Projects/proposed-folder' },
  }), {
    name: 'Edited proposal name',
    directory: '/home/user/Projects/proposed-folder',
  });
});

test('maps every application session state to its visible label', () => {
  assert.deepEqual(
    ['starting', 'running', 'waitingForInput', 'readyForReview', 'reconnecting', 'unknown', 'failed'].map(sessionStatusLabel),
    ['Starting', 'Running', 'Waiting for input', 'Ready for review', 'Reconnecting', 'Unknown', 'Failed'],
  );
});

test('task completion and cleanup adapters preserve command contracts and errors', async () => {
  const calls = [];
  const invoke = async (name, payload) => { calls.push([name, payload]); return resultForCommand(name); };
  assert.deepEqual(await completeTask(invoke, 'task-1'), { task: completedTask, cleanupJobs: [] });
  await listTaskCleanupJobs(invoke, 'task-1');
  await retryTaskCleanup(invoke, 'task-1');
  assert.deepEqual(calls, [
    ['task_complete', { taskId: 'task-1' }],
    ['task_cleanup_jobs', { taskId: 'task-1' }],
    ['task_cleanup_retry', { taskId: 'task-1' }],
  ]);
  await assert.rejects(() => completeTask(() => Promise.reject(new Error('cannot reopen')), 'task-1'), /cannot reopen/);
});

function createShellView() {
  const classes = [];
  return {
    connectionStatus: { textContent: '' },
    connectionIndicator: { classList: { add: (name) => classes.push(name) } },
    commandResult: { textContent: '' },
    appVersion: { textContent: '' },
    classes,
  };
}

test('formats the app-owned Rust shell response for visible UI output', () => {
  assert.equal(
    formatShellResponse({
      appName: 'OpenCode Project Manager',
      version: '0.1.0',
      status: 'ready',
      message: 'The Rust core and management storage are initialized.',
    }),
    'OpenCode Project Manager · ready · The Rust core and management storage are initialized.',
  );
});

test('keeps Rust-reported startup storage failures visible without labeling storage ready', () => {
  const response = formatShellResponse({
    appName: 'OpenCode Project Manager',
    version: '0.1.0',
    status: 'error',
    message:
      'Management storage could not be initialized: migration failed. Management features are unavailable.',
  });

  assert.equal(
    response,
    'OpenCode Project Manager · error · Management storage could not be initialized: migration failed. Management features are unavailable.',
  );
  assert.match(response, /Management features are unavailable/);
  assert.doesNotMatch(response, /storage are initialized/);
});

test('rejects responses that do not match the Rust command contract', () => {
  assert.throws(
    () => formatShellResponse({ appName: 'OpenCode Project Manager' }),
    {
      name: 'TypeError',
      message: 'The Rust core returned an invalid application shell response.',
    },
  );
});

test('invokes app_shell_info without a payload and maps a successful response to the visible shell', async () => {
  const view = createShellView();
  const invocations = [];
  const response = {
    appName: 'OpenCode Project Manager',
    version: '0.1.0',
    status: 'ready',
    message: 'The Rust core and management storage are initialized.',
  };

  await loadApplicationShell({
    invoke: (...args) => {
      invocations.push(args);
      return Promise.resolve(response);
    },
    ...view,
  });

  assert.deepEqual(invocations, [['app_shell_info']]);
  assert.equal(view.commandResult.textContent, formatShellResponse(response));
  assert.equal(view.appVersion.textContent, 'Version 0.1.0');
  assert.equal(view.connectionStatus.textContent, 'Connected to the Rust core');
  assert.deepEqual(view.classes, ['is-connected']);
});

test('shows Rust-reported storage unavailability without treating the core as disconnected', async () => {
  const view = createShellView();
  const invocations = [];
  const response = {
    appName: 'OpenCode Project Manager',
    version: '0.1.0',
    status: 'error',
    message:
      'Management storage could not be initialized: migration failed. Management features are unavailable.',
  };

  await loadApplicationShell({
    invoke: (...args) => {
      invocations.push(args);
      return Promise.resolve(response);
    },
    ...view,
  });

  assert.deepEqual(invocations, [['app_shell_info']]);
  assert.equal(view.commandResult.textContent, formatShellResponse(response));
  assert.equal(view.appVersion.textContent, 'Version 0.1.0');
  assert.equal(
    view.connectionStatus.textContent,
    'Rust core connected; management storage unavailable',
  );
  assert.deepEqual(view.classes, ['has-error']);
});

test('maps a rejected app_shell_info invocation to a visible connection error', async () => {
  const view = createShellView();
  const invocations = [];
  const error = new Error('invoke failed');

  await loadApplicationShell({
    invoke: (...args) => {
      invocations.push(args);
      return Promise.reject(error);
    },
    ...view,
  });

  assert.deepEqual(invocations, [['app_shell_info']]);
  assert.equal(view.connectionStatus.textContent, 'Could not connect to the Rust core');
  assert.equal(view.commandResult.textContent, String(error));
  assert.deepEqual(view.classes, ['has-error']);
});

test('checks the lazily-owned OpenCode runtime with the exact no-payload command contract', async () => {
  const invocations = [];
  const response = {
    executable: '/home/user/.opencode/bin/opencode',
    version: '2.0.27 · server 2.0.27',
    baseUrl: 'http://127.0.0.1:4101',
  };
  const result = await checkOpenCodeRuntime((...args) => {
    invocations.push(args);
    return Promise.resolve(response);
  });
  assert.deepEqual(invocations, [['opencode_runtime_info']]);
  assert.deepEqual(result, response);
  assert.equal('password' in result, false);
});

test('preserves OpenCode runtime command errors for the caller', async () => {
  await assert.rejects(
    () => checkOpenCodeRuntime(() => Promise.reject('incompatible OpenCode CLI')),
    /incompatible OpenCode CLI/,
  );
});

test('session adapters use explicit IDs and exact command payloads', async () => {
  const calls = [];
  const invoke = (...args) => {
    calls.push(args);
    return Promise.resolve(resultForCommand(args[0]));
  };
  await getSessionHistory(invoke, 'ses_exact', { order: 'asc', limit: 25 });
  await getSessionStatus(invoke, 'ses_exact');
  await reconcileSession(invoke, 'ses_exact', '17');
  assert.deepEqual(calls, [
    ['opencode_session_history', { sessionId: 'ses_exact', order: 'asc', limit: 25 }],
    ['opencode_session_status', { sessionId: 'ses_exact' }],
    ['opencode_session_reconcile', { sessionId: 'ses_exact', cursor: '17' }],
  ]);
});

test('task-session and pending-input adapters preserve exact session identity', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  await createTaskSession(invoke, 'task-1', 'repo-1', { providerId: 'openai', id: 'm' });
  await listPendingInputs(invoke, 'ses-1');
  assert.deepEqual(calls, [
    ['task_session_create', { taskId: 'task-1', repositoryId: 'repo-1', model: { providerId: 'openai', id: 'm' } }],
    ['opencode_pending_inputs', { sessionId: 'ses-1' }],
  ]);
});

test('retry adapter uses the explicit retry command and selected model', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  const model = { providerId: 'openai', id: 'gpt-6-luna' };
  await retryQuickRequestPrompt(invoke, 'task-1', model);
  assert.deepEqual(calls, [['quick_request_retry_prompt', { requestId: 'task-1', model }]]);
});

test('session adapters preserve Rust errors and null reconnect cursors', async () => {
  const error = new Error('reconcile failed');
  await assert.rejects(
    () => reconcileSession((name, payload) => {
      assert.equal(name, 'opencode_session_reconcile');
      assert.deepEqual(payload, { sessionId: 'ses_2', cursor: null });
      return Promise.reject(error);
    }, 'ses_2'),
    (received) => received === error,
  );
});

test('terminal tabs and panels expose matching accessible relationships', () => {
  assert.deepEqual(sessionTabAttributes('ses_1', true), {
    id: 'session-tab-ses_1', role: 'tab', 'aria-controls': 'terminal-ses_1',
    'aria-selected': 'true', tabindex: '0',
  });
  assert.deepEqual(terminalAccessibilityAttributes('ses_1'), {
    role: 'tabpanel', 'aria-labelledby': 'session-tab-ses_1',
    'aria-label': 'OpenCode terminal for session ses_1',
    'aria-describedby': 'session-status', tabindex: '0',
  });
});

test('session creation, model binding, prompt, permission, and form adapters use exact contracts', async () => {
  const calls = [];
  const invoke = (...args) => {
    calls.push(args);
    return Promise.resolve(resultForCommand(args[0]));
  };
  await createSession(invoke, {
    title: 'Task',
    directory: '/tmp/task',
    model: { providerId: 'openai', id: 'gpt-6-luna' },
  });
  await bindSessionModel(invoke, 'ses_exact', { providerId: 'openai', id: 'gpt-6-luna' });
  const model = { providerId: 'openai', id: 'gpt-6-luna' };
  await sendInitialPrompt(invoke, 'ses_exact', 'Start', model);
  await replyToPermission(invoke, 'ses_exact', 'p1', 'once', 'approved');
  await replyToForm(invoke, 'ses_exact', 'f1', { name: 'Ada' });
  await cancelForm(invoke, 'ses_exact', 'f1');
  assert.deepEqual(calls, [
    ['opencode_session_create', {
      title: 'Task', directory: '/tmp/task', model: { providerId: 'openai', id: 'gpt-6-luna' },
    }],
    ['opencode_session_model', {
      sessionId: 'ses_exact', model: { providerId: 'openai', id: 'gpt-6-luna' },
    }],
    ['opencode_session_prompt', { sessionId: 'ses_exact', prompt: 'Start', model }],
    ['opencode_permission_reply', {
      sessionId: 'ses_exact', requestId: 'p1', decision: 'once', message: 'approved',
    }],
    ['opencode_form_reply', { sessionId: 'ses_exact', requestId: 'f1', answer: { name: 'Ada' } }],
    ['opencode_form_cancel', { sessionId: 'ses_exact', requestId: 'f1' }],
  ]);
});

test('new session adapters preserve serialized results and rejected errors', async () => {
  const result = { id: 'ses_7', location: { directory: '/tmp/task' } };
  assert.deepEqual(await createSession(() => Promise.resolve(result), {
    title: 't', directory: '/tmp/task', model: { providerId: 'p', id: 'm' },
  }), result);
  const error = new Error('permission failed');
  await assert.rejects(
    () => replyToPermission(() => Promise.reject(error), 'ses_7', 'p1', 'reject'),
    (received) => received === error,
  );
});

test('workspace adapters preserve navigation and setup command boundaries', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  await loadWorkspaceNavigation(invoke);
  await createWorkspace(invoke, 'Todo', 'Plan');
  await createInitializedWorkspace(invoke, 'Ready', { providerId: 'openai', id: 'gpt-6-luna' }, 'Plan the project', 'proposal-1');
  await createWorkspaceTask(invoke, 'w1', { providerId: 'openai', id: 'gpt-6-luna' }, 'Implement task', 'Task summary', []);
  await createWorkspaceTask(invoke, 'w1', { providerId: 'openai', id: 'gpt-6-luna' }, 'Parser', 'Update parser behavior', ['repo-1']);
  await createWorkspaceTask(invoke, 'w1', { providerId: 'openai', id: 'gpt-6-luna' }, 'Cross-repo task', 'Coordinate both repositories', ['repo-a', 'repo-b']);
  await scanRepositories(invoke, ['/home/me/code'], { '/home/me/code/app': 'web app' });
  await listRepositoryCatalog(invoke);
  await attachRepository(invoke, 'w1', 'r1');
  await createWorkspaceSession(invoke, 'w1', 'Inspect', { providerId: 'openai', id: 'gpt-6-luna' });
  assert.deepEqual(calls, [
    ['workspace_navigation'],
    ['workspace_create', { name: 'Todo', description: 'Plan' }],
    ['workspace_create_initialized', { name: 'Ready', description: 'Plan the project', model: { providerId: 'openai', id: 'gpt-6-luna' }, proposalSessionId: 'proposal-1' }],
    ['task_create', { workspaceId: 'w1', model: { providerId: 'openai', id: 'gpt-6-luna' }, name: 'Implement task', description: 'Task summary', repositoryIds: [] }],
    ['task_create', { workspaceId: 'w1', model: { providerId: 'openai', id: 'gpt-6-luna' }, name: 'Parser', description: 'Update parser behavior', repositoryIds: ['repo-1'] }],
    ['task_create', { workspaceId: 'w1', model: { providerId: 'openai', id: 'gpt-6-luna' }, name: 'Cross-repo task', description: 'Coordinate both repositories', repositoryIds: ['repo-a', 'repo-b'] }],
    ['repository_scan', { paths: ['/home/me/code'], purposeProposals: { '/home/me/code/app': 'web app' } }],
    ['repository_catalog'],
    ['repository_attach', { workspaceId: 'w1', repositoryId: 'r1' }],
    ['workspace_session_create', { workspaceId: 'w1', prompt: 'Inspect', model: { providerId: 'openai', id: 'gpt-6-luna' } }],
  ]);
});

test('repository directory picker scans only the selected folders and handles cancel', async () => {
  const calls = [];
  const result = {
    repositories: [
      { id: 'repo-a', name: 'repo-a', repositoryPath: '/code/repo-a', repositoryIdentity: 'identity-a', purpose: null, purposeStatus: 'unavailable', createdAt: 1, updatedAt: 1 },
      { id: 'repo-b', name: 'repo-b', repositoryPath: '/work/repo-b', repositoryIdentity: 'identity-b', purpose: null, purposeStatus: 'unavailable', createdAt: 1, updatedAt: 1 },
    ],
    errors: [],
  };
  const invoke = async (name, payload) => {
    calls.push([name, payload]);
    return result;
  };
  let options;
  let scanStartedWith;
  const picked = await addRepositoryDirectories(invoke, async (value) => {
    options = value;
    return ['/code/repo-a', '/work/repo-b'];
  }, (paths) => {
    scanStartedWith = paths;
  });
  assert.deepEqual(options, {
    directory: true,
    multiple: true,
    title: 'Add repository directories',
  });
  assert.deepEqual(scanStartedWith, ['/code/repo-a', '/work/repo-b']);
  assert.equal(picked, result);
  assert.deepEqual(calls, [[
    'repository_scan',
    { paths: ['/code/repo-a', '/work/repo-b'], purposeProposals: null },
  ]]);

  calls.length = 0;
  assert.equal(await addRepositoryDirectories(invoke, async () => null), null);
  assert.deepEqual(calls, []);
});

test('directory page and repository enabled adapter preserve explicit payloads and errors', async () => {
  const calls = [];
  const invoke = async (name, payload) => {
    calls.push([name, payload]);
    if (name === 'repository_directory_page') return repositoryDirectoryPage;
    return null;
  };
  assert.deepEqual(await loadRepositoryDirectoryPage(invoke), repositoryDirectoryPage);
  await setRepositoryEnabled(invoke, 'repo-1', false);
  assert.deepEqual(calls, [
    ['repository_directory_page', undefined],
    ['repository_enabled_set', { repositoryId: 'repo-1', enabled: false }],
  ]);
  await assert.rejects(setRepositoryEnabled(async () => { throw new Error('denied'); }, 'repo-1', false), /denied/);
});

test('New-work proposal adapters preserve exact session and prompt boundary', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  const model = { providerId: 'openai', id: 'gpt-6-luna' };
  await startNewWorkProposal(invoke, model);
  await runNewWorkProposal(invoke, 'proposal-session-1', 'Original prompt', 'workspace-1', 'task');
  await readNewWorkProposal(invoke, 'proposal-session-1', 'workspace-1');
  await closeNewWorkProposal(invoke, 'proposal-session-1');
  assert.deepEqual(calls, [
    ['new_work_proposal_start', { model }],
    ['new_work_proposal_run', { sessionId: 'proposal-session-1', originalPrompt: 'Original prompt', preferredWorkspaceId: 'workspace-1', workType: 'task' }],
    ['new_work_proposal_read', { sessionId: 'proposal-session-1', preferredWorkspaceId: 'workspace-1' }],
    ['new_work_proposal_close', { sessionId: 'proposal-session-1' }],
  ]);
  assert.deepEqual(await runNewWorkProposal(async () => resultForCommand('new_work_proposal_run'), 'proposal-session-1', 'Original prompt'), newWorkProposal);
  await assert.rejects(
    runNewWorkProposal(async () => { throw new Error('artifact missing'); }, 'proposal-session-1', 'Original prompt'),
    /artifact missing/,
  );
});

test('workspace lifecycle and Quick Request promotion adapters preserve explicit contracts', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  await completeWorkspace(invoke, 'w1');
  await reactivateWorkspace(invoke, 'w1');
  await promoteQuickRequest(invoke, 'qr1', 'w1', null, 'task-slug');
  assert.deepEqual(calls, [
    ['workspace_complete', { workspaceId: 'w1' }],
    ['workspace_reactivate', { workspaceId: 'w1' }],
    ['quick_request_promote', {
      requestId: 'qr1', targetWorkspaceId: 'w1', newWorkspaceName: null, targetSlug: 'task-slug',
    }],
  ]);
});

test('task setup controls use durable status and repository retry commands', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  const model = { providerId: 'openai', id: 'gpt-6-luna' };
  await getTaskSetupStatus(invoke, 'task-1');
  await cancelTaskSetup(invoke, 'task-1');
  await resumeTaskSetup(invoke, 'task-1', 'setup-task-1', 'ses-1');
  await retryTaskSetup(invoke, 'task-2', model);
  assert.deepEqual(calls, [
    ['task_setup_status', { taskId: 'task-1' }],
    ['task_setup_cancel', { taskId: 'task-1' }],
    ['task_setup_resume', { taskId: 'task-1', operationId: 'setup-task-1', sessionId: 'ses-1' }],
    ['task_setup_retry', { taskId: 'task-2', model }],
  ]);
});

test('task setup status shows per-repository outcomes and recovery details', () => {
  assert.equal(formatTaskSetupStatus({
    task: { setupStatus: 'incomplete' },
    repositories: [
      { repositoryId: 'repo-1', setupStatus: 'ready', branch: 'task-branch', worktreePath: '/worktrees/task' },
      { repositoryId: 'repo-2', setupStatus: 'failed', errorDetail: 'branch already exists' },
    ],
  }), 'Setup incomplete. repo-1 · ready · branch task-branch · /worktrees/task repo-2 · failed · branch already exists');
});

test('ready Task refresh has no routine notice, while incomplete setup remains visible', () => {
  assert.equal(taskSetupStatusNotice({
    task: { setupStatus: 'ready' },
    repositories: [{ repositoryId: 'repo-a', setupStatus: 'ready' }],
  }), null);
  assert.equal(taskSetupStatusNotice({
    task: { setupStatus: 'incomplete' },
    repositories: [{ repositoryId: 'repo-a', setupStatus: 'failed', errorDetail: 'terminal attach failed' }],
  }), 'Setup incomplete. repo-a · failed · terminal attach failed');
});

test('New-work starting prompt submits only through the matching owner command', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  const model = { providerId: 'openai', id: 'gpt-6-luna' };
  await submitNewWorkStartingPrompt(invoke, {
    type: 'workspace', sessionId: 'ses-w', model,
  }, 'Plan the project');
  assert.throws(() => submitNewWorkStartingPrompt(invoke, {
    type: 'task', id: 'task-1', operationId: 'setup-1', sessionId: 'ses-t', model,
  }, 'Implement the feature'), /no valid owner/);
  await submitNewWorkStartingPrompt(invoke, {
    type: 'quick_request', id: 'quick-1', model,
  }, 'Summarize the logs');
  assert.deepEqual(calls, [
    ['opencode_session_prompt', { sessionId: 'ses-w', prompt: 'Plan the project', model }],
    ['quick_request_start_prompt', { requestId: 'quick-1', model }],
  ]);
  await assert.rejects(
    submitNewWorkStartingPrompt(async () => { throw new Error('prompt failed'); }, {
      type: 'workspace', sessionId: 'ses-w', model,
    }, 'Plan the project'),
    /prompt failed/,
  );
});

test('task setup cancel, resume, and refresh adapters preserve rejected Rust errors', async () => {
  const error = new Error('setup unavailable');
  const invoke = (name) => {
    assert.deepEqual(
      ['task_setup_cancel', 'task_setup_resume', 'task_setup_status'].includes(name),
      true,
    );
    return Promise.reject(error);
  };
  await assert.rejects(() => cancelTaskSetup(invoke, 'task-1'), (received) => received === error);
  await assert.rejects(
    () => resumeTaskSetup(invoke, 'task-1', 'op-1', 'ses-1'),
    (received) => received === error,
  );
  await assert.rejects(() => getTaskSetupStatus(invoke, 'task-1'), (received) => received === error);
});

test('workspace command failures remain visible and identify the failed action', () => {
  assert.equal(formatWorkspaceError('Attach', new Error('identity mismatch')), 'Attach failed: Error: identity mismatch');
});

test('completed task history remains selectable under its owning workspace', () => {
  const selection = selectWorkspaceTask({
    workspaces: [{ id: 'w1', name: 'Workspace', status: 'completed' }],
    tasks: [{ id: 't1', workspaceId: 'w1', name: 'Finished', status: 'completed' }],
  }, 't1');
  assert.equal(selection.task.name, 'Finished');
  assert.equal(selection.workspace.name, 'Workspace');
  assert.equal(selectWorkspaceTask({ workspaces: [], tasks: [] }, 'missing'), null);
});

test('workspace navigation model nests active and completed tasks beneath their workspace', () => {
  const navigation = {
    workspaces: [
      { id: 'w1', kind: 'regular', status: 'active' },
      { id: 'w2', kind: 'regular', status: 'completed' },
    ],
    tasks: [
      { id: 't1', workspaceId: 'w1', status: 'active' },
      { id: 't2', workspaceId: 'w2', status: 'completed' },
    ],
  };
  const model = workspaceNavigationModel(navigation);
  assert.deepEqual(model.map(({ workspace, tasks }) => [workspace.id, tasks.map((task) => task.id)]), [
    ['w1', ['t1']],
    ['w2', ['t2']],
  ]);
  assert.deepEqual(workspaceTasks(navigation, 'w2'), [navigation.tasks[1]]);
});

test('Task workspace chooser lists active regular workspaces and accepts a contextual preselection', () => {
  const workspaces = [
    { id: 'workspace-a', name: 'Alpha', kind: 'regular', status: 'active' },
    { id: 'workspace-b', name: 'Beta', kind: 'regular', status: 'completed' },
    { id: 'workspace-quick', name: 'Quick Requests', kind: 'quick_requests', status: 'active' },
  ];
  assert.deepEqual(taskWorkspaceOptions(workspaces), [{ id: 'workspace-a', name: 'Alpha' }]);
  assert.equal(preferredTaskWorkspaceId(workspaces, 'workspace-a'), 'workspace-a');
  assert.equal(preferredTaskWorkspaceId(workspaces, 'workspace-b'), '');
  assert.equal(preferredTaskWorkspaceId(workspaces, null), '');
});

test('workspace creation selection uses the workspace returned by Rust after refresh', () => {
  const created = { id: 'w-new', name: 'New workspace' };
  const refreshed = { workspaces: [{ id: 'w-new', name: 'New workspace', status: 'active' }] };
  assert.equal(selectCreatedWorkspace(refreshed, created), refreshed.workspaces[0]);
});

test('tracked-session selection stays within its exact owner and preserves an open tab choice', () => {
  const navigation = {
    sessions: [
      { ...session, openCodeSessionId: 'workspace-session', owner: { owner_type: 'workspace', owner_id: 'w1' } },
      { ...session, openCodeSessionId: 'task-session-old', owner: { owner_type: 'task', owner_id: 't1' } },
      { ...session, openCodeSessionId: 'task-session-new', owner: { owner_type: 'task', owner_id: 't1' }, createdAt: 2 },
      { ...session, openCodeSessionId: 'unrelated-newest', owner: { owner_type: 'task', owner_id: 't2' }, createdAt: 3 },
    ],
  };
  assert.equal(trackedSessionForOwner(navigation, 'task', 't1').openCodeSessionId, 'task-session-new');
  assert.equal(trackedSessionForOwner(navigation, 'task', 't1', 'task-session-old').openCodeSessionId, 'task-session-old');
  assert.equal(trackedSessionForOwner(navigation, 'task', 't1', undefined, ['task-session-old']).openCodeSessionId, 'task-session-old');
  assert.equal(trackedSessionForOwner(navigation, 'task', 'missing'), null);
});

test('terminal command adapters preserve names, payloads, results, and errors', async () => {
  const calls = [];
  const result = { replay: [] };
  const invoke = (name, ...rest) => { calls.push([name, ...rest]); return Promise.resolve(name === 'opencode_terminal_write' || name === 'opencode_terminal_resize' || name === 'opencode_terminal_detach' || name === 'opencode_terminal_cleanup' ? null : result); };
  assert.deepEqual(await attachTerminal(invoke, 'ses_a', '/tmp/a'), result);
  assert.deepEqual(await startTerminal(invoke, 'ses_b', '/tmp/b'), result);
  assert.equal(await writeTerminal(invoke, 'ses_a', '\u001b[A'), null);
  assert.equal(await resizeTerminal(invoke, 'ses_b', 112, 28), null);
  assert.equal(await detachTerminal(invoke, 'ses_a'), null);
  assert.equal(await cleanupTerminal(invoke, 'ses_b'), null);
  assert.deepEqual(calls, [
    ['opencode_terminal_attach', { sessionId: 'ses_a', directory: '/tmp/a' }],
    ['opencode_terminal_start', { sessionId: 'ses_b', directory: '/tmp/b' }],
    ['opencode_terminal_write', { sessionId: 'ses_a', data: '\u001b[A' }],
    ['opencode_terminal_resize', { sessionId: 'ses_b', cols: 112, rows: 28 }],
    ['opencode_terminal_detach', { sessionId: 'ses_a' }],
    ['opencode_terminal_cleanup', { sessionId: 'ses_b' }],
  ]);
  const error = new Error('terminal unavailable');
  await assert.rejects(() => writeTerminal(() => Promise.reject(error), 'ses_a', 'x'), (received) => received === error);
});

test('restoring a session reconciles history without invoking the prompt command', async () => {
  const calls = [];
  const invoke = (name, payload) => {
    calls.push([name, payload]);
    return Promise.resolve(resultForCommand(name));
  };
  const result = await restoreSession(invoke, 'ses_restore', '17');
  assert.deepEqual(result, { history, status, reconciliation });
  assert.deepEqual(calls, [
    ['opencode_session_history', { sessionId: 'ses_restore', order: 'asc', limit: 500 }],
    ['opencode_session_status', { sessionId: 'ses_restore' }],
    ['opencode_session_reconcile', { sessionId: 'ses_restore', cursor: '17' }],
  ]);
  assert.equal(calls.some(([name]) => name === 'opencode_session_prompt'), false);
});

test('Quick Request adapters preserve command names, explicit payloads, results, and errors', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  const model = { providerId: 'openai', id: 'gpt-6-luna' };
  await createQuickRequest(invoke, 'check this', model, 'repo-1');
  await resolveQuickRequestDirectory(invoke, 'repo-1');
  await followUpQuickRequest(invoke, 'quick-1', 'hello\r');
  await restoreQuickRequest(invoke, 'quick-1');
  await listQuickRequests(invoke, true);
  await deleteQuickRequest(invoke, 'quick-1');
  await expireQuickRequest(invoke, 'quick-1');
  assert.deepEqual(calls, [
    ['quick_request_create', { prompt: 'check this', model, repositoryId: 'repo-1' }],
    ['quick_request_resolve_directory', { repositoryId: 'repo-1' }],
    ['quick_request_follow_up', { requestId: 'quick-1', data: 'hello\r' }],
    ['quick_request_restore', { requestId: 'quick-1' }],
    ['quick_request_list', { request: { history: true } }],
    ['quick_request_delete', { requestId: 'quick-1' }],
    ['quick_request_expire', { requestId: 'quick-1' }],
  ]);
  const error = new Error('request failed');
  await assert.rejects(() => createQuickRequest(() => Promise.reject(error), 'x', model), (received) => received === error);
  await assert.rejects(
    () => resolveQuickRequestDirectory(() => Promise.reject(new Error('repository disappeared')), 'repo-1'),
    /repository disappeared/,
  );
});

test('Quick Request list adapter sends the nested Tauri request payload', async () => {
  const calls = [];
  await listQuickRequests((...args) => {
    calls.push(args);
    return Promise.resolve([]);
  }, true);

  assert.deepEqual(calls, [['quick_request_list', { request: { history: true } }]]);
});

test('Quick Request startup and model catalog adapters use explicit contracts', async () => {
  const calls = [];
  const invoke = (...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); };
  const model = { providerId: 'openai', id: 'gpt-6-luna' };
  await listAvailableModels(invoke);
  await getDefaultModel(invoke);
  await startQuickRequestPrompt(invoke, 'quick-1', model);
  assert.deepEqual(calls, [
    ['opencode_models'],
    ['opencode_model_default'],
    ['quick_request_start_prompt', { requestId: 'quick-1', model }],
  ]);
});

test('Quick Request submit preserves surrounding UI state and clears only the prompt after full success', async () => {
  const events = [];
  const promptInput = { value: 'Explain this change' };
  const selectedModel = { providerId: 'openai', id: 'gpt-6-luna' };
  const record = {
    task: {
      ...task,
      id: 'quick-1',
      quickRequest: { createdAt: 1, dismissedAt: null, expiresAt: 2, expiredAt: null, promotedAt: null },
    },
    session: { ...session, openCodeSessionId: 'ses-quick-1' },
    prompt: 'Explain this change',
  };
  const invoke = async (name, payload) => {
    events.push([name, payload]);
    if (name === 'quick_request_create') return record;
    if (name === 'quick_request_start_prompt') return null;
    throw new Error(`Unexpected command ${name}`);
  };

  const result = await submitQuickRequestFlow({
    invoke,
    promptInput,
    promptText: promptInput.value,
    model: selectedModel,
    waitForTerminal: async () => events.push(['terminal-ready']),
    showSession: async (sessionId) => events.push(['show-session', sessionId]),
    refreshRequests: async () => events.push(['refresh-requests']),
  });

  assert.equal(result, record);
  assert.deepEqual(events.map(([name]) => name), [
    'terminal-ready', 'quick_request_create', 'show-session',
    'quick_request_start_prompt', 'refresh-requests',
  ]);
  assert.equal(events[2][1], 'ses-quick-1');
  assert.equal(events[1][1].prompt, 'Explain this change');
  assert.deepEqual(events[3][1], { requestId: 'quick-1', model: selectedModel });
  assert.equal(promptInput.value, '');
});

test('Quick Request submit failure preserves entered prompt for recovery', async () => {
  const promptInput = { value: 'Keep this if startup fails' };
  const events = [];
  await assert.rejects(() => submitQuickRequestFlow({
    invoke: async (name) => {
      events.push(name);
      if (name === 'quick_request_create') return {
        task: {
          ...task,
          id: 'quick-1',
          quickRequest: { createdAt: 1, dismissedAt: null, expiresAt: 2, expiredAt: null, promotedAt: null },
        },
        session: { ...session, openCodeSessionId: 'ses-quick-1' },
        prompt: 'Keep this if startup fails',
      };
      throw new Error('prompt submission failed');
    },
    promptInput,
    promptText: promptInput.value,
    model: { providerId: 'openai', id: 'gpt-6-luna' },
    waitForTerminal: async () => {},
    showSession: async () => {},
    refreshRequests: async () => events.push('refresh'),
  }), /prompt submission failed/);
  assert.equal(promptInput.value, 'Keep this if startup fails');
  assert.ok(!events.includes('refresh'));
});

test('confirmed Quick Request flow preserves the original prompt and opens the terminal page before sending it', async () => {
  const events = [];
  const model = { providerId: 'openai', id: 'gpt-6-luna' };
  const originalPrompt = '  Keep this exact prompt\n';
  const record = {
    task: { ...task, id: 'quick-confirmed', workspaceId: 'quick-workspace' },
    session: { ...session, openCodeSessionId: 'ses-quick-confirmed' },
    prompt: originalPrompt,
  };
  const result = await submitResolvedQuickRequestFlow({
    invoke: async (name, payload) => {
      events.push([name, payload]);
      if (name === 'quick_request_create') return record;
      return null;
    },
    originalPrompt,
    model,
    repositoryId: 'repo-1',
    waitForTerminal: async () => events.push(['terminal-ready']),
    onCreated: (created) => events.push(['created', created.task.id]),
    showSession: async (id) => events.push(['show-session', id]),
    refreshRequests: async () => events.push(['refresh']),
  });

  assert.equal(result, record);
  assert.deepEqual(events.map(([name]) => name), [
    'terminal-ready', 'quick_request_create', 'created', 'show-session',
    'quick_request_start_prompt', 'refresh',
  ]);
  assert.deepEqual(events[1], ['quick_request_create', {
    prompt: originalPrompt,
    model,
    repositoryId: 'repo-1',
  }]);
  assert.deepEqual(events[4], ['quick_request_start_prompt', {
    requestId: 'quick-confirmed', model,
  }]);
});

test('confirmed Quick Request startup failure happens after durable creation and terminal-page opening', async () => {
  const events = [];
  await assert.rejects(() => submitResolvedQuickRequestFlow({
    invoke: async (name) => {
      events.push(name);
      if (name === 'quick_request_create') return {
        task: { ...task, id: 'quick-recoverable', workspaceId: 'quick-workspace' },
        session: { ...session, openCodeSessionId: 'ses-recoverable' },
        prompt: 'Retry me',
      };
      throw new Error('initial prompt delivery failed');
    },
    originalPrompt: 'Retry me',
    model: { providerId: 'openai', id: 'gpt-test' },
    repositoryId: null,
    waitForTerminal: async () => {},
    onCreated: () => events.push('durable-record'),
    showSession: async () => events.push('terminal-mounted'),
    refreshRequests: async () => events.push('refresh'),
  }), /initial prompt delivery failed/);
  assert.deepEqual(events, [
    'quick_request_create', 'durable-record', 'terminal-mounted',
    'quick_request_start_prompt',
  ]);
});

test('Quick Request retry and terminal accessibility helpers preserve explicit contracts', async () => {
  const calls = [];
  await retryQuickRequestPrompt((...args) => { calls.push(args); return Promise.resolve(resultForCommand(args[0])); }, 'quick-1', { providerId: 'openai', id: 'm' });
  assert.deepEqual(calls, [['quick_request_retry_prompt', { requestId: 'quick-1', model: { providerId: 'openai', id: 'm' } }]]);
  assert.deepEqual(sessionTabAttributes('ses-1', true), { id: 'session-tab-ses-1', role: 'tab', 'aria-controls': 'terminal-ses-1', 'aria-selected': 'true', tabindex: '0' });
  assert.deepEqual(terminalAccessibilityAttributes('ses-1'), { role: 'tabpanel', 'aria-labelledby': 'session-tab-ses-1', 'aria-label': 'OpenCode terminal for session ses-1', 'aria-describedby': 'session-status', tabindex: '0' });
  assert.deepEqual(controlErrorAttributes('quick-error'), { 'aria-describedby': 'quick-error', 'aria-invalid': 'true' });
});
