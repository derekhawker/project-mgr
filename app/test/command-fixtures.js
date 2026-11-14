// Representative serialized values returned by the Rust command DTOs.  Keep
// these fixtures strict: boundary tests should exercise the same shapes that
// Tauri serializes, rather than using convenient `{}`/`{ ok: true }` values.
export const task = {
  id: "task-1",
  workspaceId: "workspace-1",
  name: "Task",
  slug: "task",
  description: null,
  homePath: "/tmp/task",
  status: "active",
  setupStatus: "pending",
  createdAt: 1,
  completedAt: null,
  quickRequest: null,
  setupOperationId: null,
  setupSessionId: null,
  setupCancelledAt: null,
  setupCancellationDetail: null,
};

export const completedTask = { ...task, status: "completed", completedAt: 2 };

export const session = {
  openCodeSessionId: "ses-1",
  owner: { owner_type: "task", owner_id: "task-1" },
  directory: "/tmp/task",
  lastKnownStatus: "running",
  createdAt: 1,
  updatedAt: 1,
  eventCursor: null,
  reconciliationStatus: "complete",
  reconciliationUncertain: false,
  pendingInputJson: null,
  selectedModel: "openai/gpt-6-luna",
};

export const history = {
  sessionId: "ses-1",
  data: [],
  cursor: { previous: null, next: null },
};

export const status = {
  sessionId: "ses-1",
  active: null,
  outcome: null,
  applicationStatus: "running",
};

export const reconciliation = {
  sessionId: "ses-1",
  cursor: null,
  history,
  active: null,
  permissions: [],
  forms: [],
  durableEvents: [],
  status: "complete",
};

export const pendingInputs = { sessionId: "ses-1", permissions: [], forms: [] };

export const workspace = {
  id: "workspace-1",
  name: "Workspace",
  slug: "workspace",
  description: null,
  homePath: "/tmp/workspace",
  kind: "regular",
  status: "active",
  createdAt: 1,
  completedAt: null,
};

export const navigation = {
  workspaces: [workspace],
  tasks: [task],
  sessions: [session],
  workspaceRepositories: [],
  workspaceSessionContexts: [],
  workspaceTickets: {},
  quickRequests: [],
};

export const terminal = { replay: [] };

export const newWorkProposal = {
  schemaVersion: 1,
  workType: "quick_request",
  repositories: [],
};

export const cleanupJobs = [];

export const repositoryDirectoryPage = {
  directories: [
    {
      path: "/code",
      repositories: [
        {
          repository: {
            id: "repo-1",
            name: "repo-1",
            repositoryPath: "/code/repo-1",
            repositoryIdentity: "identity-1",
            purpose: null,
            purposeStatus: "unavailable",
            createdAt: 1,
            updatedAt: 1,
          },
          enabled: true,
        },
      ],
    },
  ],
};

export function resultForCommand(name) {
  switch (name) {
    case "opencode_session_history":
      return history;
    case "new_work_proposal_start":
      return { sessionId: "proposal-session-1" };
    case "new_work_proposal_run":
      return newWorkProposal;
    case "new_work_proposal_close":
      return null;
    case "opencode_session_status":
      return status;
    case "opencode_session_reconcile":
      return reconciliation;
    case "opencode_pending_inputs":
      return pendingInputs;
    case "opencode_session_pending_inputs":
      return pendingInputs;
    case "opencode_pending_inputs_all":
      return [pendingInputs];
    case "task_session_create":
    case "workspace_session_create":
      return session;
    case "task_complete":
      return { task: completedTask, cleanupJobs };
    case "task_cleanup_jobs":
    case "task_cleanup_retry":
      return cleanupJobs;
    case "workspace_navigation":
      return navigation;
    case "workspace_ticket_work":
      return { session };
    case "workspace_ticket_session_create":
      return { ...session, openCodeSessionId: "ses-ticket-new" };
    case "workspace_ticket_session_close":
      return null;
    case "workspace_tickets_list":
      return [{
        filename: "example.md",
        title: "Example ticket",
        status: "draft",
        hasWorkSession: false,
        content: "---\ntitle: Example ticket\nstatus: draft\n---\nExample body",
        modifiedAt: 1_793_700_000_000,
        archivedAt: null,
      }];
    case "repository_directory_page":
      return repositoryDirectoryPage;
    case "repository_soft_delete_many":
      return null;
    case "repository_library_get":
    case "repository_library_set":
      return "/repos/library";
    case "workspace_create":
    case "workspace_complete":
    case "workspace_reactivate":
      return workspace;
    case "task_create":
      return { task, sessions: [session], repositories: [] };
    case "task_setup_retry":
      return { task, sessions: [session], repositories: [] };
    case "task_setup_cancel":
    case "task_setup_resume":
      return task;
    case "task_setup_status":
      return { task, session, repositories: [], repositoryIds: null };
    case "quick_request_create":
    case "quick_request_restore":
      return { task, session: null, prompt: "Original Quick Request prompt" };
    case "quick_request_resolve_directory":
      return "/tmp/quick-requests";
    case "quick_request_list":
      return [];
    case "quick_request_delete":
      return null;
    case "quick_request_dismiss":
    case "quick_request_expire":
    case "quick_request_promote":
      return task;
    case "quick_request_retry_prompt":
    case "opencode_session_restore":
      return session;
    case "opencode_terminal_attach":
    case "opencode_terminal_start":
    case "opencode_terminal_replay":
      return terminal;
    case "opencode_terminal_restart":
      return null;
    case "repository_catalog":
      return [];
    case "repository_scan":
      return { repositories: [], errors: [] };
    case "opencode_models":
      return [];
    case "opencode_model_default":
      return { providerId: "openai", id: "gpt-6-luna" };
    case "opencode_model_default_set":
      return { providerId: "openai", id: "gpt-6-luna" };
    case "workspace_ticket_proposal":
      return { title: "Fixture proposal", body: "# Fixture proposal\n\n## Idea\n\nFixture body." };
    case "workspace_ticket_create":
      return {
        filename: "fixture-proposal.md",
        title: "Fixture proposal",
        status: "draft",
        hasWorkSession: false,
        opencodeStatus: null,
        content: "---\ntitle: Fixture proposal\nstatus: draft\n---\n\nFixture body.\n",
        modifiedAt: 1,
        archivedAt: null,
      };
    case "app_shell_info":
      return {
        appName: "OpenCode Project Manager",
        version: "0.1.0",
        status: "ready",
        message: "Ready",
      };
    case "opencode_runtime_info":
      return {
        executable: "opencode",
        version: "2.0.27",
        baseUrl: "http://127.0.0.1:4101",
      };
    case "opencode_session_create":
      return { id: "ses-1", location: { directory: "/tmp/task" } };
    default:
      return null;
  }
}
