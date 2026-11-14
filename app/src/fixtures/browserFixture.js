// A browser fixture, not an implementation of the Rust backend. It never
// invokes native APIs, network, persistent storage, filesystem, or processes.
const timestamp = 1700000000000;
let navigatorWidth = 300;
let changeReviewMode = "unified";
let defaultModel = { providerId: "fixture", id: "model" };
let createdWorkspaceTickets = [];
let ticketSessionSequence = 0;
let portSelection = "3000-3010,4200,4321,5000-5010,5173-5180,5432,6379,8000-8010,8080-8090,9229,27017";
let fixtureListeners = [
  { pid: 18432, identity: "fixture-node-18432", name: "node", owner: "derekhawker", addresses: ["127.0.0.1:3000"], ports: [3000], cwd: "/fixture/repository", command: "node ./node_modules/.bin/vite --host 127.0.0.1", startTime: "2026-10-30 09:14:22" },
  { pid: 18607, identity: "fixture-node-18607", name: "node", owner: "derekhawker", addresses: ["127.0.0.1:5173", "[::1]:5173"], ports: [5173], cwd: "/fixture/repository", command: "node ./node_modules/vite/bin/vite.js", startTime: "2026-10-30 09:18:05" },
  { pid: 912, identity: "fixture-postgres-912", name: "postgres", owner: "postgres", addresses: ["127.0.0.1:5432"], ports: [5432], cwd: "/var/lib/postgresql", command: "postgres -D /var/lib/postgresql/data", startTime: "2026-10-29 16:42:11" },
];
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
const ticketSessions = new Map();
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
// Opt-in stress data for browser layout checks; normal fixture flows stay small.
if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("navigationOverflow")) {
  for (let index = 1; index <= 30; index++) {
    workspaces.push(makeWorkspace(`overflow-workspace-${index}`, `Workspace ${index}`));
    const id = `overflow-request-${index}`;
    quickRequests.push({
      ...quickRequests[0],
      task: {
        ...quickRequests[0].task,
        id,
        slug: id,
        name: `Quick Request ${index}`,
        createdAt: Date.now(),
        quickRequest: { ...quickRequests[0].task.quickRequest, createdAt: Date.now() },
      },
      prompt: `Quick Request ${index}`,
    });
  }
}
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
      result = defaultModel;
      break;
    case "opencode_model_default_set":
      defaultModel = request;
      result = defaultModel;
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
        workspaceTickets: {
          [example.id]: [
            {
              filename: "example-active.md",
              title: "Example active ticket",
              status: "in_progress",
              hasWorkSession: true,
              modifiedAt: timestamp,
            },
            {
              filename: "example-blocked.md",
              title: "Example blocked ticket",
              status: "blocked",
              hasWorkSession: false,
              modifiedAt: timestamp - 1,
            },
            {
              filename: "example-draft-session.md",
              title: "Example draft in progress",
              status: "draft",
              hasWorkSession: true,
              modifiedAt: timestamp - 2,
            },
            {
              filename: "example-new-draft.md",
              title: "Example new draft",
              status: "draft",
              hasWorkSession: false,
              modifiedAt: timestamp - 3,
            },
          ],
        },
      };
      break;
    case "workspace_tickets_list":
      result = request.archived
        ? [{
            filename: "archived-example.md",
            title: "Investigate inability to submit a large Markdown document in the create-ticket prompt",
            status: "done",
            hasWorkSession: false,
            modifiedAt: 1_762_400_000_000,
            archivedAt: "2025-11-14T00:00:00.000Z",
            content: "---\ntitle: Investigate inability to submit a large Markdown document in the create-ticket prompt\nstatus: done\narchived_at: \"2025-11-14T00:00:00.000Z\"\n---\n# Investigate inability to submit a large Markdown document in the create-ticket prompt\n\nThis archived ticket remains readable.",
          }]
        : [
            {
              filename: "blocked-example.md",
              title: "Blocked example ticket",
              status: "blocked",
              hasWorkSession: false,
              modifiedAt: 1_793_500_000_000,
              archivedAt: null,
              content: "---\ntitle: Blocked example ticket\nstatus: blocked\nowner: Browser fixture\n---\n# Blocked ticket\n\nThis entry verifies blocked-status priority and formatted frontmatter.\n\n- First check\n- Second check",
            },
            {
              filename: "in-progress-example.md",
              title: "In-progress example ticket",
              status: "in_progress",
              hasWorkSession: false,
              modifiedAt: 1_793_600_000_000,
              archivedAt: null,
              content: "---\ntitle: In-progress example ticket\nstatus: in_progress\n---\n# In progress\n\nThis entry verifies the in-progress status position.",
            },
            {
              filename: "example.md",
              title: "Example ticket",
              status: "draft",
              hasWorkSession: true,
              modifiedAt: 1_793_700_000_000,
              archivedAt: null,
              content: `---\ntitle: Example ticket\nstatus: draft\nwork_session_id: fixture-session\n---\n# Example ticket\n\nA fixture ticket for the Workspace with readable **Markdown**.\n\n${"This long paragraph checks reader scrolling and keeps the full ticket body available. ".repeat(28)}\n\n## Acceptance checks\n\n- List and reader scroll independently\n- Metadata follows the body\n\n\`\`\`js\nconsole.log("safe fixture Markdown");\n\`\`\``,
            },
            {
              filename: "other-example.md",
              title: "Other-status example",
              status: "review",
              hasWorkSession: false,
              modifiedAt: 1_793_650_000_000,
              archivedAt: null,
              content: "---\ntitle: Other-status example\nstatus: review\n---\nAn unknown status follows draft.",
            },
          ].concat(
            createdWorkspaceTickets
              .filter((ticket) => ticket.workspaceId === request.workspaceId)
              .map(({ workspaceId, ...ticket }) => ticket),
          );
      break;
    case "workspace_ticket_proposal": {
      if (!workspaces.some((item) => item.id === request.workspaceId)) throw new Error("Workspace was not found");
      result = {
        title: "Improve workspace onboarding",
        body: "# Improve workspace onboarding\n\n## Idea\n\nMake the first-run setup clearer.",
      };
      break;
    }
    case "workspace_ticket_create": {
      const workspace = workspaces.find((item) => item.id === request.workspaceId);
      if (!workspace) throw new Error("Workspace was not found");
      const base = request.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ticket";
      let filename = `${base}.md`;
      let suffix = 2;
      while (createdWorkspaceTickets.some((ticket) => ticket.workspaceId === workspace.id && ticket.filename === filename)) filename = `${base}-${suffix++}.md`;
      result = {
        filename,
        title: request.title,
        status: "draft",
        hasWorkSession: false,
        opencodeStatus: null,
        content: `---\ntitle: ${JSON.stringify(request.title)}\nstatus: draft\n---\n\n${request.body}\n`,
        modifiedAt: Date.now(),
        archivedAt: null,
      };
      createdWorkspaceTickets.push({ ...result, workspaceId: workspace.id });
      break;
    }
    case "workspace_ticket_work": {
      const workspace = workspaces.find((item) => item.id === payload.workspaceId);
      if (!workspace) throw new Error("Workspace was not found");
      const key = `${workspace.id}:${payload.filename}`;
      const id = workspace.id === example.id && payload.filename === "example.md"
        ? `session-${workspace.id}`
        : `fixture-ticket-work-${workspace.id}-${payload.filename}`;
      const ids = ticketSessions.get(key) || [id];
      ticketSessions.set(key, ids);
      const entries = ids.map((sessionId) => {
        let session = sessions.find((item) => item.openCodeSessionId === sessionId);
        if (!session) { session = { ...makeSession(workspace), openCodeSessionId: sessionId }; sessions.push(session); }
        return session;
      });
      result = { session: entries.at(-1) };
      break;
    }
    case "workspace_ticket_session_create": {
      const workspace = workspaces.find((item) => item.id === payload.workspaceId);
      if (!workspace) throw new Error("Workspace was not found");
      const key = `${workspace.id}:${payload.filename}`;
      const sessionId = `fixture-ticket-session-${++ticketSessionSequence}`;
      result = { ...makeSession(workspace), openCodeSessionId: sessionId };
      sessions.push(result);
      ticketSessions.set(key, [sessionId]);
      break;
    }
    case "workspace_ticket_session_close": {
      const key = `${payload.workspaceId}:${payload.filename}`;
      const ids = (ticketSessions.get(key) || []).filter((id) => id !== payload.sessionId);
      ticketSessions.set(key, ids);
      result = ids.at(-1) || null;
      break;
    }
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
      result = { shared: { fileNavigator: { width: navigatorWidth } }, changeReview: { mode: changeReviewMode }, ports: { selection: portSelection } };
      break;
    case "presentation_preferences_set_navigator_width":
      navigatorWidth = payload.request.width;
      result = { shared: { fileNavigator: { width: navigatorWidth } }, changeReview: { mode: changeReviewMode }, ports: { selection: portSelection } };
      break;
    case "presentation_preferences_set_change_review_mode":
      if (!["unified", "split"].includes(payload.request.mode)) throw new Error("Invalid diff mode.");
      changeReviewMode = payload.request.mode;
      result = { shared: { fileNavigator: { width: navigatorWidth } }, changeReview: { mode: changeReviewMode }, ports: { selection: portSelection } };
      break;
    case "presentation_preferences_set_port_selection":
      portSelection = request.selection;
      result = { shared: { fileNavigator: { width: navigatorWidth } }, changeReview: { mode: changeReviewMode }, ports: { selection: portSelection } };
      break;
    case "ports_list":
      result = fixtureListeners;
      break;
    case "ports_stop":
      // Simulate a successful stop in fixture state only; never signal a process.
      fixtureListeners = fixtureListeners.filter((listener) => !(listener.pid === payload.pid && listener.identity === payload.identity));
      result = null;
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
    case "workspace_create": {
      const workspace = makeWorkspace(
        `fixture-created-${nextWorkspace++}`,
        request.name,
      );
      if (request.repositoryId) {
        const selected = [example, ...workspaces].find(
          (entry) => entry.id === request.repositoryId,
        );
        if (selected) workspace.homePath = selected.homePath;
      }
      workspaces.push(workspace);
      result = workspace;
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
                packageScriptEntries: [{ name: "test", directory: "" }],
                makeTargetEntries: [{ name: "build", directory: "" }],
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
