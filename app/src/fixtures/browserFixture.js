// A browser fixture, not an implementation of the Rust backend. It never
// invokes native APIs, network, persistent storage, filesystem, or processes.
const timestamp = 1700000000000;
let navigatorWidth = 300;
let changeReviewMode = "unified";
const makeWorkspace = (id, name) => ({
  id,
  name,
  slug: id,
  description: "Fixture workspace",
  homePath: `/fixture/${id}`,
  kind: "regular",
  status: "active",
  createdAt: timestamp,
  completedAt: null,
});
const makeSession = (workspace) => ({
  openCodeSessionId: `session-${workspace.id}`,
  owner: { owner_type: "workspace", owner_id: workspace.id },
  directory: workspace.homePath,
  lastKnownStatus: "running",
  createdAt: timestamp,
  updatedAt: timestamp,
  eventCursor: null,
  reconciliationStatus: "current",
  reconciliationUncertain: false,
  pendingInputJson: null,
  selectedModel: null,
});
const example = makeWorkspace("fixture-workspace", "Example Workspace");
const repository = {
  id: "fixture-repo",
  name: "Example repository",
  repositoryPath: "/fixture/repository",
  repositoryIdentity: "fixture",
  purpose: "Example repository",
  purposeStatus: "ready",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const workspaces = [example];
const sessions = [makeSession(example)];
const seededQuickRequestId = "fixture-quick-seeded";
const seededQuickRequestSession = {
  ...makeSession({
    id: seededQuickRequestId,
    homePath: "/fixture/Quick Requests",
  }),
  owner: { owner_type: "task", owner_id: seededQuickRequestId },
};
const quickRequests = [
  {
    task: {
      id: seededQuickRequestId,
      workspaceId: "fixture-quick-requests",
      name: "Fixture Quick Request",
      slug: seededQuickRequestId,
      description: null,
      homePath: "/fixture/Quick Requests",
      status: "active",
      setupStatus: "ready",
      createdAt: timestamp,
      completedAt: null,
      quickRequest: {
        createdAt: timestamp,
        dismissedAt: null,
        expiresAt: null,
        expiredAt: null,
        promotedAt: null,
      },
      setupOperationId: null,
      setupSessionId: null,
      setupCancelledAt: null,
      setupCancellationDetail: null,
    },
    session: seededQuickRequestSession,
    prompt:
      "Review the Quick Requests page layout, verify that this long prompt wraps cleanly and clamps after three lines, then confirm the folder Open action and bulk-delete selection controls remain aligned and usable. ".repeat(
        5,
      ),
  },
];
sessions.push(seededQuickRequestSession);
let nextWorkspace = 1;
let nextTool = 1;
let nextQuickRequest = 1;
const softDeletedRepositoryIds = new Set();
const terminalReplay = (sessionId) => ({
  replay: [
    {
      kind: "output",
      sessionId,
      dataBase64:
        "Rml4dHVyZSB0ZXJtaW5hbDogbm8gcHJvY2VzcyB3YXMgc3RhcnRlZC4NCg==",
      operation: null,
      message: null,
    },
  ],
});
const quickDirectory = (id) => {
  if (id === null) return "/fixture/Quick Requests";
  if (id === repository.id) return repository.repositoryPath;
  throw new Error("Unknown fixture repository");
};
const findQuickRequest = (id) => {
  const record = quickRequests.find((item) => item.task.id === id);
  if (!record) throw new Error("Unknown fixture Quick Request");
  return record;
};

export async function invokeBrowserFixture(name, payload = {}) {
  const request = payload.request || payload;
  let result;
  switch (name) {
    case "app_shell_info":
      result = {
        appName: "OpenCode Project Manager",
        version: "fixture",
        status: "fixture",
        message: "Browser fixture: no Rust connection",
      };
      break;
    case "opencode_models":
      result = [
        {
          providerID: "fixture",
          id: "model",
          name: "Fixture model",
          enabled: true,
          status: null,
        },
      ];
      break;
    case "opencode_model_default":
      result = { providerId: "fixture", id: "model" };
      break;
    case "opencode_pending_inputs_all":
      result = [];
      break;
    case "quick_request_list":
      result = quickRequests;
      break;
    case "workspace_navigation":
      result = {
        workspaces,
        tasks: quickRequests.map((record) => record.task),
        sessions,
        workspaceRepositories: [
          {
            workspaceId: example.id,
            repositoryId: repository.id,
            checkoutPath: "/fixture/repository",
            checkoutMode: "worktree",
            branch: "fixture",
            verificationStatus: "verified",
            createdAt: timestamp,
          },
        ],
        workspaceSessionContexts: sessions
          .filter((s) => s.owner.owner_type === "workspace")
          .map((s) => ({
            openCodeSessionId: s.openCodeSessionId,
            workspaceId: s.owner.owner_id,
            role: "workspace",
            repositoryId: null,
          })),
        quickRequests,
      };
      break;
    case "repository_catalog":
      result = softDeletedRepositoryIds.has(repository.id) ? [] : [repository];
      break;
    case "repository_directory_page":
      result = {
        directories: [{
          path: "/fixture",
          repositories: softDeletedRepositoryIds.has(repository.id)
            ? []
            : [{ repository, enabled: true }],
        }],
      };
      break;
    case "repository_soft_delete_many":
      for (const id of request.repositoryIds) softDeletedRepositoryIds.add(id);
      result = null;
      break;
    case "repository_scan":
      result = { repositories: [repository], errors: [] };
      break;
    case "repository_library_get":
      result = "/fixture/repositories";
      break;
    case "docs_list":
      result = [
        { path: "README.md", repositoryId: null, repositoryName: null },
        {
          path: "guides/getting-started.md",
          repositoryId: null,
          repositoryName: null,
        },
        {
          path: "guides/reference/commands.txt",
          repositoryId: null,
          repositoryName: null,
        },
      ];
      break;
    case "docs_read":
      result = {
        path: payload.request.path,
        contents: "# Fixture\n\nNo files are read.",
      };
      break;
    case "presentation_preferences_get":
      result = { shared: { fileNavigator: { width: navigatorWidth } }, changeReview: { mode: changeReviewMode } };
      break;
    case "presentation_preferences_set_navigator_width":
      navigatorWidth = payload.request.width;
      result = { shared: { fileNavigator: { width: navigatorWidth } }, changeReview: { mode: changeReviewMode } };
      break;
    case "presentation_preferences_set_change_review_mode":
      if (!["unified", "split"].includes(payload.request.mode)) throw new Error("Invalid diff mode.");
      changeReviewMode = payload.request.mode;
      result = { shared: { fileNavigator: { width: navigatorWidth } }, changeReview: { mode: changeReviewMode } };
      break;
    case "change_review_load":
      result = [
        {
          repositoryId: repository.id,
          name: repository.name,
          path: "/fixture/repository",
          comparisonTarget: "origin/main",
          comparisonError: null,
          files: [
            {
              path: "src/example.js",
              status: "M",
              diff: "--- a/src/example.js\n+++ b/src/example.js\n@@ -3,5 +3,5 @@\n function greet(name) {\n-  return 'Hello ' + name;\n+  return `Hello, ${name}!`;\n }\n \n greet('world');\n",
              diffError: null,
            },
          ],
        },
      ];
      break;
    case "change_review_full_diff":
      if (
        payload.request.repositoryId !== repository.id ||
        payload.request.path !== "src/example.js"
      )
        throw new Error("Unknown fixture file.");
      result =
        "--- a/src/example.js\n+++ b/src/example.js\n@@ -1,8 +1,8 @@\n // Example fixture\n \n function greet(name) {\n-  return 'Hello ' + name;\n+  return `Hello, ${name}!`;\n }\n \n greet('world');\n // End of file\n";
      break;
    case "new_work_proposal_preview":
      result = `Proposal prompt preview: ${payload.originalPrompt}`;
      break;
    case "new_work_proposal_start":
      result = { sessionId: "fixture-proposal" };
      break;
    case "new_work_proposal_run":
      result = {
        schemaVersion: 1,
        workType: request.workType || "workspace",
        workspace: {
          id: null,
          name: "Example proposal",
          intent: "Fixture proposal",
        },
        task: null,
        repositories: [],
        startingPrompt: request.originalPrompt,
        setupPlan: {
          workspaceHome: "/fixture/new-workspace",
          repositories: [],
        },
      };
      break;
    case "new_work_proposal_close":
    case "opencode_session_prompt":
    case "opencode_terminal_resize":
    case "opencode_terminal_write":
    case "opencode_terminal_cleanup":
    case "repo_tool_terminal_resize":
    case "repo_tool_terminal_write":
    case "repo_tool_terminal_cleanup":
      result = null;
      break;
    case "quick_request_resolve_directory":
      result = quickDirectory(request.repositoryId);
      break;
    case "quick_request_create": {
      if (!request.prompt?.trim())
        throw new Error("Enter an original prompt first.");
      const directory = request.directory || quickDirectory(request.repositoryId);
      const id = `fixture-quick-${nextQuickRequest++}`;
      const task = {
        id,
        workspaceId: "fixture-quick-requests",
        name: `Quick Request ${nextQuickRequest - 1}`,
        slug: id,
        description: null,
        homePath: directory,
        status: "active",
        setupStatus: "ready",
        createdAt: timestamp,
        completedAt: null,
        quickRequest: {
          createdAt: timestamp,
          dismissedAt: null,
          expiresAt: null,
          expiredAt: null,
          promotedAt: null,
        },
        setupOperationId: null,
        setupSessionId: null,
        setupCancelledAt: null,
        setupCancellationDetail: null,
      };
      const session = {
        ...makeSession({ id, homePath: directory }),
        owner: { owner_type: "task", owner_id: id },
      };
      const record = { task, session, prompt: request.prompt };
      quickRequests.push(record);
      sessions.push(session);
      result = record;
      break;
    }
    case "quick_request_start_prompt":
      findQuickRequest(request.requestId);
      result = null;
      break;
    case "quick_request_restore":
      result = findQuickRequest(request.requestId);
      break;
    case "quick_request_delete": {
      const record = findQuickRequest(request.requestId);
      quickRequests.splice(quickRequests.indexOf(record), 1);
      sessions.splice(sessions.indexOf(record.session), 1);
      result = null;
      break;
    }
    case "workspace_create_initialized": {
      const workspace = makeWorkspace(
        `fixture-created-${nextWorkspace++}`,
        request.name,
      );
      const session = makeSession(workspace);
      workspaces.push(workspace);
      sessions.push(session);
      result = { workspace, sessions: [session], setup: [], sessionErrors: [] };
      break;
    }
    case "opencode_session_restore":
      result = sessions.find((s) => s.openCodeSessionId === payload.sessionId);
      if (!result) throw new Error("Unknown fixture session");
      break;
    case "opencode_terminal_replay":
      result = terminalReplay(payload.sessionId);
      break;
    case "opencode_terminal_attach":
      result = terminalReplay(payload.sessionId);
      break;
    case "opencode_session_status":
      result = {
        sessionId: request.sessionId,
        active: null,
        outcome: null,
        applicationStatus: "running",
      };
      break;
    case "opencode_pending_inputs":
      result = { sessionId: request.sessionId, permissions: [], forms: [] };
      break;
    case "opencode_session_reconcile":
      result = {
        sessionId: request.sessionId,
        cursor: null,
        history: {
          sessionId: request.sessionId,
          data: [],
          cursor: { previous: null, next: null },
        },
        active: null,
        permissions: [],
        forms: [],
        durableEvents: [],
        status: "running",
      };
      break;
    case "repo_tools_list":
      result =
        request.ownerId === example.id
          ? [
              {
                repositoryId: repository.id,
                name: repository.name,
                path: "/fixture/repository",
                packageScripts: ["test"],
                makeTargets: ["build"],
                npmInstallNeeded: false,
              },
            ]
          : [];
      break;
    case "repo_tool_terminal_start":
      result = {
        terminalId: `fixture-tool-${nextTool++}`,
        label: `Fixture ${request.name}`,
        directory: "/fixture/repository",
      };
      break;
    case "repo_tool_terminal_replay":
      result = terminalReplay(payload.terminalId);
      break;
    default:
      console.error(`[browser fixture] blocked unsupported command: ${name}`);
      throw new Error(
        `Browser fixture does not implement ${name}; no live action was performed.`,
      );
  }
  return structuredClone(result);
}
