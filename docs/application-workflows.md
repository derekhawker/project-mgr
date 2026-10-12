# Application Workflows

This specification defines the actors, state changes, and sequence flows for
the application. It is the durable reference for application behavior and
for the boundaries between the GUI, Rust core, OpenCode, Git, SQLite, and the
filesystem.

The application uses Tauri, Rust, raw HTML/CSS/JavaScript, a Rust-managed PTY,
xterm.js, and a version-checked app-owned OpenCode server and CLI contract. The
installed v2.0.27 contract is recorded in [`opencode-v2-contract.md`](opencode-v2-contract.md);
historical v1 evidence remains in the prototype notes. OpenCode conversation
history remains in OpenCode; SQLite stores
only application associations and lifecycle state.

OpenCode reports repository, branch, and worktree setup through a structured
registration tool. Rust validates each report and writes authoritative
associations to SQLite. The tool reports management state; it does not replace
the application command boundary or duplicate OpenCode conversation history.

## 2. Actors

| Actor | Responsibility | Does not own |
|---|---|---|
| User | Chooses work, supplies prompts, reviews results, answers requests, and changes lifecycle state. | Direct database, process, or Git bookkeeping. |
| GUI | Renders navigation, forms, status, terminal views, history, and lifecycle controls. Sends explicit commands to Rust. | OpenCode history, authoritative associations, or filesystem validation. |
| Tauri/Rust core | Owns application commands, validation, SQLite writes, OpenCode child processes, PTYs, event forwarding, recovery, and cleanup scheduling. | Conversation content or model decisions. |
| SQLite management store | Persists workspaces, tasks, repositories, associations, sessions, settings, lifecycle state, and cleanup state. | Notes, resources, Git history, or duplicate conversation transcripts. |
| Filesystem | Stores workspace/task home folders, notes, resources, and the Quick Request directory. | Lifecycle truth for records; SQLite remains authoritative for management state. |
| Git | Identifies repositories and branches and reports worktree cleanliness and usage. | Workspace/task lifecycle or OpenCode conversation history. |
| OpenCode server | Creates sessions, accepts prompts, owns conversation history, exposes history/status/events, and performs model-backed work. | GUI management state and the application's authoritative repository associations. |
| OpenCode TUI | Provides the interactive terminal experience, including follow-ups, approvals, and user-input requests. | Application navigation, lifecycle records, and cleanup decisions. |
| PTY/runtime | Runs one attached OpenCode TUI per session and carries terminal bytes, input, resize, and exit events. | Session identity resolution. |
| Recovery/cleanup worker | Reconciles sessions and schedules or performs eligible worktree cleanup while the app remains alive. | User decisions and conversation history. |
| OS/tray | Keeps the Tauri process available while its window is hidden and exposes show/quit actions. | Application state and cleanup policy. |

The GUI never infers a regular session from the newest session in a directory.
The owning workspace, task, or Quick Request record stores the exact OpenCode
session ID and working directory.

## 3. Canonical Storage Layout

### 3.1 Management state

The app stores management state in SQLite in the normal OS application-data
location. It does not require a shared Git repository.

SQLite records include:

- Workspaces and their lifecycle state.
- Tasks and their owning workspace and lifecycle state.
- Repository catalog entries and repository identity.
- Workspace repository bindings and main-branch checkout paths.
- Task repository bindings, branches, and worktree paths.
- OpenCode session IDs, session owners, working directories, and last-known
  status.
- Quick Request creation, dismissal, expiry, and promotion state.
- Cleanup jobs, attempts, deferrals, and failure details.
- User preferences, including the project-home root.

SQLite does not store a second copy of conversation messages.

### 3.2 User project home

Regular work is rooted in the user's home folder at the persisted
project-home setting. Its default value is:

```text
~/OpenCode Projects/
```

The application creates the configured directory when regular work is first
created. The default name is intentionally specific to this application rather
than the generic `workspaces`; a custom project-home value must remain inside
the user's home folder.

A regular workspace uses this conceptual layout:

```text
~/OpenCode Projects/<workspace>/
├── notes/
├── repos/
└── tasks/
    └── <task>/
        ├── notes/
        └── worktrees/
```

Existing repositories may remain at their current locations. A workspace
repository binding records the existing location or the managed main-branch
checkout path; the product does not silently move repositories.

### 3.3 Quick Requests

Quick Requests are a special workspace and use one shared directory under the
system temporary directory. They do not get individual home folders. Their
management records and exact session IDs belong in SQLite. In the GUI, show
requests created in the last 24 hours in a secondary Quick Requests section of
the persistent left navigation; do not make Quick Requests the main page.

## 3.4 Navigation and workspace focus

Keep the Workspace → Task tree prominent in persistent left navigation. Show
all open workspaces, including idle ones, with tasks nested directly under their
workspace. Do not require a separate all-workspaces summary screen: selecting a
workspace renders its working area in the main pane. Provide a visible
workspace-creation action in the navigation and a task-creation action scoped
to the selected workspace. In a selected workspace, keep these controls compact
and give the interactive OpenCode terminal almost all of the main/right pane.
Show recent Quick Requests below the workspace tree as a distinct, lower-priority
navigation section.

## 4. Core Invariants

1. The hierarchy is exactly `Workspace -> Task`.
2. Every task belongs to exactly one workspace.
3. Quick Requests are tasks under the special Quick Requests workspace.
4. A task may use multiple repositories and multiple sessions.
5. Workspace sessions use workspace/main-branch context for planning and
   inspection.
6. Task sessions use the task home and task worktrees for implementation.
7. All sessions for one task share that task's working environment.
8. OpenCode owns conversation history; SQLite stores associations only.
9. A new session means a new OpenCode conversation in the same owner context;
   it does not create a child task.
10. Completed tasks cannot be reopened. Further work starts as a new task.
11. Completing a task does not commit, merge, or discard code.
12. A workspace cannot be completed while it has active tasks.
13. A completed task's clean worktree is removable only when no session uses it.
14. Removing a worktree never removes its branch.
15. Dirty worktrees and worktrees containing new files remain in place.
16. Hiding a terminal view or the main window does not stop OpenCode work.
17. Full application quit stops app-owned TUI and server children.
18. A failed event subscription, session creation, PTY attachment, or required
   validation stops the affected flow with a visible error.

## 5. Common Session Flow

Every session type uses the same terminal runtime. Only the context resolver
changes how the owner, session ID, and working directory are found.

### 5.1 Create and start a new session

For the installed OpenCode v2.0.27 contract, Rust uses the authenticated v2
session API and launches the root TUI against the returned session ID and exact
directory. See [`opencode-v2-contract.md`](opencode-v2-contract.md) for the
versioned route and response details. The session is associated with its owner
before generation starts. The GUI must show an explicit model choice from the
enabled OpenCode model catalog. The app-owned default setting
(`openai/gpt-6-luna` in the Quick Request prototype) preselects the choice; it
must never trigger fallback to OpenCode's model default. Rust validates the
chosen model and binds it to the session both at creation and immediately before
the initial prompt.

```http
POST /api/session
{"title":"...","location":{"directory":"/absolute/path"},"model":{"providerID":"openai","id":"gpt-6-luna"}}
```

The response is wrapped as `{"data":{"id":"ses_...", ...}}`. Rust then
starts the interactive TUI with:

```sh
opencode --server "$SERVER_URL" --session "$SESSION_ID" "$DIRECTORY"
```

Only after the matching TUI is open and its output path is ready does Rust send
the initial prompt with `POST /api/session/{sessionID}/prompt` and a
`{"text":"..."}` body. Rust owns the server password and API client, passes
the password only to the app-owned server and TUI child processes that need it,
and never exposes it to the WebView.

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses an available model and submits a workspace, task, or Quick Request prompt. | The GUI disables duplicate submission and shows session startup. |
| 2 | GUI | Sends a typed command to Rust containing the owner ID, prompt, selected model, and relevant preferences. | Rust receives explicit owner and model choices, not a foreground-session or OpenCode-default guess. |
| 3 | Rust | Validates the owner, prompt, selected model, working directory, and repository/worktree context. Creates the directory if the flow requires it. | Invalid input fails before a model prompt is sent. |
| 4 | Rust | Ensures the app-owned OpenCode server for the context is healthy. | The server is ready before session creation. |
| 5 | Rust | Calls authenticated OpenCode `POST /api/session` with the exact `location.directory` and selected `model`. | OpenCode returns an exact session ID in the `data` response wrapper. |
| 6 | Rust | Writes the session association to SQLite before starting generation. | The owner can recover the exact session after a restart. |
| 7 | Rust | Allocates a PTY and launches the root TUI as `opencode --server <url> --session <id> <directory>`. | One TUI process is attached to the exact session and directory. |
| 8 | Rust | Starts reading PTY output immediately and emits ordered output and exit events. | Output cannot be lost because the GUI is still constructing its terminal. |
| 9 | GUI | Registers terminal event listeners, creates xterm, registers the XTGETTCAP handler, opens the terminal, and replays buffered output. | The user can see the TUI before generation begins. |
| 10 | Rust | Confirms the attached TUI is alive and the output path is ready. | The initial prompt is not sent to a missing terminal. |
| 11 | Rust | Revalidates and sets the selected model through `POST /api/session/{sessionID}/model`. | The exact user choice is active on the session; OpenCode's default is not consulted. |
| 12 | Rust | Calls authenticated `POST /api/session/{sessionID}/prompt` with the initial prompt as `text`. | Generation begins in the already visible TUI. |
| 13 | OpenCode | Generates, runs tools, requests approval/input when necessary, and updates the session. | The TUI streams the real interactive response. |
| 14 | Rust/GUI | Forwards output, status events, PTY exit, and errors to the matching session view. | The user sees the session's current state without an app transcript. |

### 5.2 Resume an existing session

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Selects a workspace, task, or Quick Request session to restore. | The GUI asks Rust for that owner's stored session. |
| 2 | Rust | Reads the exact session ID and working directory from SQLite. | No newest-session heuristic is used for regular work. |
| 3 | Rust | Checks whether the session's TUI/PTY is already owned by the app. | Existing runtime is reused when possible. |
| 4 | Rust | Otherwise allocates a PTY and launches the root TUI with `--server`, `--session`, and the exact directory. | The same OpenCode conversation is reopened. |
| 5 | GUI | Creates the terminal, registers protocol handlers, and replays any buffered output. | Existing TUI history is visible. |
| 6 | Rust/GUI | Reconciles current OpenCode status, pending input, and event cursor. | The GUI reports running, waiting, ready, failed, or uncertain state. |
| 7 | Rust | Does not call the initial-prompt endpoint. | Restore never generates a duplicate response. |

### 5.3 Follow-up, approval, or user input

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Types into the focused xterm session. | Input is associated with the selected exact session ID. |
| 2 | GUI | Sends terminal bytes to Rust. | Rust receives raw TUI input, including control sequences. |
| 3 | Rust | Writes and flushes bytes to that session's PTY. | OpenCode's TUI receives the follow-up or selection. |
| 4 | OpenCode TUI | Submits the follow-up or answers an approval/question flow. | OpenCode continues the same conversation. |
| 5 | OpenCode | Produces output or opens another input request. | The same terminal streams the next state. |
| 6 | Rust/GUI | Updates status and preserves the OpenCode-owned history. | No new Quick Request, task, or duplicate transcript is created. |

### 5.4 Session status and event recovery

The GUI exposes these application-level states:

| State | Meaning | Entry evidence |
|---|---|---|
| Starting | The app is creating or attaching the session. | Rust command is in progress. |
| Running | OpenCode is actively executing the session. | A current status/event indicates active execution. |
| Waiting for input | OpenCode needs an approval, permission, form, or terminal response. | A pending request or TUI input state is present. |
| Ready for review | The current turn has ended and the session has usable output. | Completion/idle evidence plus no pending request. |
| Reconnecting | The event stream or PTY is temporarily unavailable. | Connection or child recovery is underway. |
| Unknown | The app has insufficient evidence to classify the session. | Events were lost and reconciliation is incomplete. |
| Failed | The session or its runtime ended with a known failure. | API, process, or execution failure is confirmed. |

`inactive` alone is never treated as completed. On an event disconnect, Rust
reconnects and reconciles API status, pending requests, session history, and
the last event cursor before changing the displayed state.

## 6. Application Startup and Recovery

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | OS/Tauri | Starts the application process. | One application instance owns management state and child processes. |
| 2 | Rust | Opens SQLite and validates the schema. | The app knows the owners and associations before rendering them. |
| 3 | Rust | Loads the user project-home setting and ensures the default `~/OpenCode Projects/` root exists when needed. | Regular work has a stable location. |
| 4 | Rust | Checks the installed OpenCode version and its matching CLI/API contract. For v2.0.27 this is authenticated `/api/info`, `/api/session`, and the root TUI `--server`/`--session` contract. | Unsupported installation fails visibly at the integration boundary. |
| 5 | Rust | Starts or reconnects to app-owned OpenCode server process state. | No independently managed background service is introduced. |
| 6 | Rust | Inspects active sessions, cleanup jobs, and previously uncertain runtime records. | Recovery work is scheduled before normal actions are enabled. |
| 7 | GUI | Registers event listeners before enabling session actions. | PTY output cannot be silently dropped due to missing capability. |
| 8 | Rust/GUI | Reattaches visible or requested sessions and reconciles their state. | The GUI displays current work and uncertainty explicitly. |
| 9 | Cleanup worker | Resumes eligible cleanup jobs without deleting dirty or in-use worktrees. | Interrupted cleanup is safe to retry. |

If a previous app process still owns children, the recovery flow must not create
a second owner for the same session. It should either reconnect to the existing
runtime or report a recoverable conflict for the user.

## 7. Repository Catalog and Discovery

### 7.1 Scan user-selected folders

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses one or more folders to scan. | The GUI sends explicit paths to Rust. |
| 2 | Rust | Validates readable directories and walks them according to the scan policy. | Candidate Git repositories are identified without changing them. |
| 3 | Git | Reports repository roots, remotes, branches, and identity data. | Rust has verifiable repository facts. |
| 4 | Rust | De-duplicates candidates against the repository catalog by verified identity and path. | Existing catalog entries are updated rather than duplicated. |
| 5 | OpenCode | Generates a concise purpose description from repository content or metadata when requested by the discovery flow. | The description is proposed content, not repository identity. |
| 6 | User | Reviews or edits the purpose description. | The catalog stores the accepted concise purpose. |
| 7 | Rust | Writes the repository catalog entry and discovery result to SQLite. | Repositories can be attached to future workspaces or tasks. |

The mechanism by which OpenCode receives repository facts and returns a
description remains an implementation decision. It must not allow model output
to replace Rust's verified path or repository identity.

### 7.2 Attach a repository to a workspace

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Selects a catalog repository for a workspace, or supplies an existing path. | The GUI sends the repository reference to Rust. |
| 2 | Rust | Verifies repository identity, accessibility, and branch state. | A stale or mismatched path is rejected. |
| 3 | Rust | Records the workspace binding and intended main-branch context. | Workspace sessions can resolve the correct repository. |
| 4 | Rust/Git | Creates or validates the workspace's main-branch checkout when the chosen layout requires one. | The workspace has an inspectable main context. |
| 5 | Rust | Records the actual checkout path, branch, and verification result. | Future sessions use recorded paths, not reconstructed guesses. |

If setup is partial, the workspace remains visible with an explicit setup
problem. The app does not claim that the repository is attached until identity
and path validation succeed.

## 8. Workspace Workflows

### 8.1 Create an empty workspace

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Create workspace** and supplies a name and optional description. | The GUI validates required fields and name uniqueness. |
| 2 | GUI | Sends the creation command to Rust. | Rust owns the transaction. |
| 3 | Rust | Normalizes the name into a safe display name and filesystem slug, checking collisions. | The chosen workspace has stable identity and path. |
| 4 | Rust | Creates the workspace row in SQLite and its home, `notes/`, `repos/`, and `tasks/` directories. | Filesystem and management record are created together or the operation fails visibly. |
| 5 | Rust | Initializes the workspace as active with no tasks and no repository bindings. | The workspace appears in the persistent workspace navigation, even with no tasks. |
| 6 | GUI | Selects the new workspace in the main pane and offers repository attachment, a workspace planning session, or task creation. | The user can continue without an artificial task or a separate workspace-summary screen. |

An empty workspace is valid. Creating it does not automatically create a task.

### 8.2 Start a workspace planning session

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Start workspace session** and enters a planning or inspection prompt. | The GUI resolves the workspace owner. |
| 2 | Rust | Resolves the workspace home and bound main-branch repository paths. | OpenCode receives the workspace context, not a task worktree. |
| 3 | Rust | Creates and records a new OpenCode session, then attaches its TUI through the common session flow. | The exact session belongs to the workspace. |
| 4 | OpenCode | Inspects main-branch checkouts and edits workspace notes or requirements when requested. | Planning work stays at workspace scope. |
| 5 | User | Follows up in the same terminal or starts another workspace session. | New conversations share workspace context but retain separate histories. |

Workspace sessions do not implement task changes in task worktrees. A request
for implementation becomes a task-creation decision.

### 8.3 Complete a workspace

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Complete workspace**. | Rust checks the workspace lifecycle preconditions. |
| 2 | Rust | Queries SQLite for active tasks owned by the workspace. | Any active task blocks completion. |
| 3 | GUI | If active tasks exist, shows the blocking tasks and does not change state. | The user must complete or otherwise resolve those tasks first. |
| 4 | Rust | If no active tasks exist, marks the workspace completed and records the timestamp. | The workspace leaves the active list but remains in history. |
| 5 | GUI | Hides the completed workspace from the active navigation and keeps it available through history. | Completion is a visibility/lifecycle change, not deletion. |

Completing a workspace does not delete its home folder, notes, repositories,
branches, sessions, or task history. The behavior of active workspace-level
sessions at completion is unchanged: they continue running and remain
available from workspace history. A completed workspace must be reactivated
before a new task or workspace session can be created.

## 9. Task Workflows

### 9.1 Create a task from a workspace

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Create new task** from a workspace. | The workspace context is already selected. |
| 2 | User | Enters the task prompt and optional preferences. May explicitly select repositories. | The GUI captures intent without making a branch or worktree yet. |
| 3 | GUI | Sends the task-creation command to Rust. | Rust creates the task transaction and context. |
| 4 | Rust | Verifies the workspace is active and creates the task row and task home, `notes/`, and `worktrees/` directories. | The task has a stable owner and working directory. |
| 5 | Rust | Starts a task OpenCode session in the task home directory and records its exact session ID. | The task can be recovered independently of the GUI. |
| 6 | GUI/OpenCode | Supplies the task prompt, repository catalog context, setup instructions, and preferences through the session. | OpenCode has the information needed to plan setup. |
| 7 | OpenCode | Determines relevant repositories unless the user explicitly selected them. | Repository selection is proposed at the task level. |
| 8 | OpenCode | Creates or requests the required branches and worktrees using the available integration boundary. | Each result includes repository, branch, path, and outcome. |
| 9 | Rust | Validates each reported repository identity, branch, path, task ownership, and filesystem state. | Untrusted or mismatched setup is rejected. |
| 10 | Rust | Persists successful task repository associations and records failed or incomplete items. | Partial setup is represented rather than lost. |
| 11 | GUI | Shows setup progress and any incomplete repository work. | The user can correct setup before implementation proceeds. |
| 12 | OpenCode | Implements the task in the task worktrees after setup is usable. | Task changes are isolated from workspace main checkouts. |

OpenCode performs step 8 through its normal Git/tool execution and reports each
result through the registration tool. Rust remains authoritative for validation
and persistence.

### 9.2 Task setup with multiple repositories

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | OpenCode | Determines that the task spans multiple repositories. | Each repository is treated as an independent setup item. |
| 2 | Rust/OpenCode | Processes repository setup one item at a time or as a batch with per-item results. | A failure in one repository does not erase successful results for others. |
| 3 | Rust | Checks branch collisions, existing worktrees, repository identity, path containment, and task ownership. | Unsafe or ambiguous worktrees are rejected. |
| 4 | Rust | Stores successful associations and an itemized failure record for each unsuccessful repository. | The task has a complete setup report. |
| 5 | GUI | Shows ready, failed, and pending repositories separately. | The user can retry or adjust only the affected items. |

### 9.3 Partial task setup failure

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | Git/OpenCode | A branch, worktree, or repository setup operation fails. | The failure includes the repository and attempted operation. |
| 2 | Rust | Verifies whether any filesystem or Git side effect occurred. | Partial side effects are not hidden. |
| 3 | Rust | Persists the task as setup-incomplete and records successful and failed items. | The task remains recoverable without pretending to be ready. |
| 4 | GUI | Shows the reason and offers retry, correction, or cancellation according to the failure. | The user can make the next decision with full context. |
| 5 | User | Retries or changes repository selection. | The retry uses the recorded state and avoids duplicate branches/worktrees. |

The app must not silently create a second task when setup fails. A failed task
creation that has already created a task record remains an explicit task
record until the user cancels or resolves it.

### 9.4 Start another task session

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **New session** from an active task. | The GUI keeps the same task owner. |
| 2 | Rust | Resolves the task home and all recorded task worktrees. | The new session receives the same task environment. |
| 3 | Rust | Creates a new OpenCode conversation and records its exact session ID under the task. | Existing session history remains separate and intact. |
| 4 | OpenCode/TUI | Runs the new conversation in the same task context. | The task may have multiple coordinated sessions. |

Starting a new task session never reopens a completed task. The user must
create a new task for further work.

### 9.5 Complete a task

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Complete task**. | The GUI explains that completion does not commit or merge code. |
| 2 | Rust | Records the completion request and checks the task exists and is active. | A completed task cannot be completed twice. |
| 3 | Rust | Marks the task completed and records the timestamp without changing Git content. | The task leaves active task lists. |
| 4 | Rust | Marks associated sessions as completed or requiring reconciliation according to their actual state. | Session history remains associated with the completed task. |
| 5 | Rust | Queues cleanup checks for each task worktree. | Cleanup can run after completion without blocking the lifecycle change. |
| 6 | GUI | Hides the task from active work and keeps it available in history. | Completion is reversible only as a data-history view, not as reopening. |
| 7 | User | Needs more work later. Creates a new task in the same workspace. | The new task gets a new identity and new session associations. |

### 9.6 Cleanup a completed task's worktrees

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | Cleanup worker | Loads a completed task's cleanup job. | The job has itemized worktree targets. |
| 2 | Cleanup worker | Checks whether any session currently uses the worktree. | In-use worktrees are deferred and remain associated. |
| 3 | Git | Reports cleanliness, including uncommitted changes and new files. | The worker has evidence for the cleanup decision. |
| 4 | Cleanup worker | If clean and unused, removes the worktree but retains its branch. | Storage is reclaimed without losing the branch. |
| 5 | Cleanup worker | If dirty or containing new files, leaves it in place and records the reason. | User work is not discarded. |
| 6 | Cleanup worker | If the worktree is in use, records a deferred retry. | A later retry can clean it after sessions stop using it. |
| 7 | GUI | Shows cleanup state and any retained worktree reason in task history. | Cleanup is observable rather than silently destructive. |

No cleanup action deletes uncommitted files, removes a retained branch, or
recreates a missing worktree automatically.

## 10. Quick Request Workflows

### 10.1 Create a Quick Request

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Enters a one-off prompt in the Quick Request area. | The GUI identifies the special Quick Requests workspace. |
| 2 | GUI | Sends the prompt to Rust. | Rust validates and trims the prompt. |
| 3 | Rust | Ensures the shared Quick Request directory and app-owned OpenCode server are ready. | All Quick Requests use the same directory. |
| 4 | Rust | Creates a session through the OpenCode API and records its ID, creation time, and owner. | The request has durable association despite the shared directory. |
| 5 | Rust/GUI | Attaches the exact session in a PTY, opens xterm, and waits for the TUI pipeline. | The interactive TUI is visible before generation. |
| 6 | Rust | Sends the initial prompt through the API. | The first response appears in the matching TUI. |
| 7 | OpenCode/TUI | Streams output, handles tools, and asks for approval/input when needed. | The user can interact in the same terminal. |
| 8 | Rust/GUI | Stores status and emits output without copying transcript content into SQLite. | The request remains associated and recoverable. |
| 9 | Scheduler | Sets expiry at 24 hours after creation. Follow-ups do not reset it. | Expiry is based on creation time, not last activity. |

### 10.2 Follow up on a Quick Request

The user enters the follow-up directly in the already attached TUI. The common
follow-up flow sends the input to the same session ID. The GUI does not create a
new Quick Request or call the initial-prompt endpoint again.

### 10.3 Dismiss and restore a Quick Request

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Dismisses a completed Quick Request from active presentation. | SQLite records dismissal; OpenCode history remains. |
| 2 | GUI | Removes it from the active Quick Request presentation but retains history access. | Dismissal does not delete the session. |
| 3 | User | Opens Quick Request history and selects the dismissed request. | The GUI resolves its stored exact session ID. |
| 4 | Rust | Reattaches or reconnects the session through the common restore flow. | Existing history renders without another initial prompt. |
| 5 | GUI | Displays the request and its current/reconciled status. | The user can review history or continue if the request is still eligible. |

The application always uses the SQLite association and exact session ID when
restoring a Quick Request. It never selects a session solely because it is the
newest session in the shared directory.

### 10.4 Quick Request expiry

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | Scheduler | Finds a Quick Request whose creation time is at least 24 hours old. | The request is eligible for expiry; follow-ups do not extend it. |
| 2 | Rust | Reconciles whether the session is running or waiting for input. | Active work is not silently terminated. |
| 3 | Rust/GUI | Keeps running or input-waiting requests visible and records expiry eligibility. | The user can finish or answer active work. |
| 4 | Rust | Once the request is no longer active, marks it expired for active navigation. | It leaves active Quick Requests but remains in history. |
| 5 | User | Opens expired history if needed. | The session and conversation remain retrievable. |

An active request that remains active past the 24-hour point stays visible until
its execution reaches a stable state. Expiry changes active navigation only; it
does not terminate the process or delete data.

### 10.5 Promote a Quick Request to regular tracked work

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Promote to tracked work** for a Quick Request. | The GUI asks for the target regular workspace or a new workspace. |
| 2 | User | Selects or creates the target workspace and supplies any required name. | Promotion has an explicit owner destination. |
| 3 | Rust | Creates or validates the regular workspace/task record and dedicated home folder. | Future sessions have a stable regular home. |
| 4 | Rust | Links the prior Quick Request record and session history to the promoted work. | Existing history is preserved. |
| 5 | Rust | Removes Quick Request expiry for the promoted work. | The work is no longer governed by the 24-hour rule. |
| 6 | Rust | Leaves earlier sessions associated with their original shared directory. | Historical sessions are not moved or rewritten. |
| 7 | GUI | Shows the promoted work under regular tracked work and offers a new session in its dedicated home. | Future work uses the regular context. |

Promotion always produces a task in the selected existing workspace or in a
new workspace created by the promotion flow. It must not rewrite earlier
OpenCode session directories.

## 11. View, Window, and Application Lifecycle

### 11.1 Hide and reopen a terminal view

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Hide view** or switches away from a terminal. | The GUI hides presentation only. |
| 2 | GUI | Removes the terminal surface from the visible layout but retains the session tab/record. | The PTY and TUI continue running. |
| 3 | Rust | Continues forwarding or buffering output for that session. | Work is not stopped by a view change. |
| 4 | User | Selects the session again. | The GUI reuses or reconnects to the exact PTY/session. |
| 5 | GUI | Replays buffered output and refits/focuses xterm. | The same terminal remains usable. |

### 11.2 Close and reopen the application window

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Closes the main window. | Tauri prevents process exit and hides the window. |
| 2 | Rust | Keeps OpenCode server, TUI processes, PTYs, SQLite state, and cleanup worker alive. | Active work continues. |
| 3 | OS/tray | Keeps a single tray presence with a show action. | The user can return to the same app process. |
| 4 | User | Chooses **Show** from the tray. | The existing window is shown and focused. |
| 5 | GUI/Rust | Reconnects visible sessions and reconciles status. | Existing work remains associated and interactive. |

### 11.3 Full application quit

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Quit** from the tray or application menu. | Rust begins an intentional shutdown. |
| 2 | Rust | Stops accepting new management commands and marks shutdown in progress. | No new child process races with teardown. |
| 3 | Rust | Stops or closes attached TUI/PTY children and waits for them. | No attached terminal is left orphaned. |
| 4 | Rust | Stops the app-owned OpenCode server and waits for it. | No app-owned server remains after quit. |
| 5 | Rust | Flushes SQLite state and cleanup job state. | Recovery can distinguish completed shutdown from interruption. |
| 6 | OS/Tauri | Exits the process. | The tray icon and application are gone. |

An immediate process exit that skips child cleanup is not acceptable.

## 12. Failure and Recovery Flows

### 12.1 Terminal listener or capability failure

1. Rust/GUI attempts to register output and exit listeners before enabling
   submission.
2. If Tauri capability or listener registration fails, the GUI shows the
   error and disables the affected terminal workflow.
3. The app does not present a healthy-looking session tab with an empty
   terminal.
4. After the configuration is corrected, startup registration is retried.

### 12.2 OpenCode server or CLI incompatibility

1. Rust checks the installed CLI version and the exact version-matched server,
API, and TUI options required by this specification. The v2.0.27 contract uses
authenticated `/api/...` routes and root TUI `--server`/`--session` options;
the v1 `attach` contract is historical only.
2. If the check fails, the GUI shows the detected incompatibility and does not
   create sessions.
3. The error includes the required contract and the detected command output.
4. The app does not silently switch to a separately managed background server,
   a different API generation, or an API-rendered transcript UI.

### 12.3 PTY or TUI startup failure

1. Rust creates the session record only with a state that records startup in
   progress.
2. If PTY allocation, attach, or readiness fails, Rust records the failure
   against the exact session ID.
3. Rust does not send the initial prompt.
4. The GUI shows recovery options such as retry attach, inspect history, or
   abandon the incomplete startup record.

### 12.4 Event stream loss

1. Rust detects a disconnected or stale event stream.
2. The GUI changes the session to `Reconnecting` or `Unknown`, not `Ready for
   review`.
3. Rust reconnects and reconciles current API status, pending input, history,
   and the event cursor.
4. Rust updates the state only after reconciliation provides sufficient
   evidence.
5. Any missed PTY output is recovered from the TUI/session reattachment path
   where possible; missing output is reported rather than fabricated.

### 12.5 User input required while the view is hidden

1. OpenCode emits a pending input, permission, or TUI state for the exact
   session.
2. Rust records the pending state and keeps the session visible in the active
   work list even if its terminal view is hidden.
3. The GUI notifies the user and provides a direct action to reopen/focus the
   session.
4. The user answers through the real TUI.
5. Rust forwards the answer and returns the session to its reconciled state.

## 13. Ownership and Operation Map

| Operation | Initiator | Authority | Mechanism |
|---|---|---|---|
| Create workspace | User/GUI | Rust + SQLite + filesystem | Tauri command |
| Attach or scan repository | User/GUI | Rust + Git + SQLite | Tauri command |
| Generate repository purpose | Rust/OpenCode flow | Rust stores the generated catalog field | OpenCode discovery session/API |
| Start workspace session | User/GUI | Rust for association; OpenCode for conversation | Common session runtime |
| Create task record and home | User/GUI | Rust + SQLite + filesystem | Tauri command |
| Select task repositories | OpenCode task session | Rust validates the selected resources | Registration tool |
| Create branch/worktree | OpenCode task session | Git performs the operation; Rust validates the result | OpenCode's normal Git/tool execution |
| Report setup result | OpenCode task session | Rust + SQLite | Registration tool |
| Start task session | User/GUI | Rust for association; OpenCode for implementation | Common session runtime |
| Complete task | User/GUI | Rust + SQLite | Tauri command |
| Clean completed worktree | Cleanup worker | Rust + Git | Background app operation |
| Complete workspace | User/GUI | Rust + SQLite | Tauri command |
| Follow up or answer input | User/TUI | OpenCode | PTY input |
| Report running/waiting/completed | OpenCode events/API | Rust reconciler | Server events and status API |
| Promote Quick Request | User/GUI | Rust + SQLite + filesystem | Tauri command |

### 13.1 Registration tool contract

The registration tool is the boundary used when OpenCode has selected or
prepared resources that belong to application-managed workspace or task state.
It is a reporting and association operation, not a second application service.

The tool accepts one idempotent setup report with:

- The owning workspace ID and task ID, when the report is task-scoped.
- The OpenCode session ID that produced the report.
- A caller-supplied operation ID.
- One result for each repository, branch, or worktree operation.
- The catalog repository ID when known.
- The canonical repository path and Git identity.
- The branch name and worktree path when applicable.
- A `ready`, `failed`, or `not_attempted` result for each item.
- A machine-readable error code and human-readable detail for failures.

Rust validates the report before writing associations:

1. The caller session belongs to the supplied workspace or task.
2. The workspace and task are active and the task belongs to that workspace.
3. The repository path resolves to the expected Git identity.
4. The branch and worktree exist when the result is `ready`.
5. A task worktree is inside the task's allowed worktree location or is an
   explicitly recorded existing location.
6. No worktree or branch is already owned by another active task in conflict
   with Git's worktree rules.
7. The operation ID has not already been applied with different content.

Rust writes accepted items and rejected items independently. A mixed report
therefore preserves successful setup while recording every failure. Repeating
the same operation ID with the same content is a no-op; repeating it with
different content is rejected.

The tool does not create a second conversation history, bypass Rust's path
validation, or delete worktrees. OpenCode performs repository setup through its
normal execution path, then reports the resulting resources through this tool.

### 13.2 Operation boundary rules

1. GUI commands are the only path for user-driven lifecycle changes.
2. OpenCode may select and prepare implementation resources, but Rust decides
   whether those resources become authoritative associations.
3. Git is the source of truth for repository identity, branch existence, and
   worktree cleanliness.
4. OpenCode is the source of truth for conversation history and model execution.
5. SQLite is the source of truth for application ownership, lifecycle state,
   and session associations.
6. Background workers may perform only operations already authorized by a
   recorded lifecycle state, such as cleanup of a completed task.

## 14. Lifecycle and Data Policies

### 14.1 Workspace completion

Only active tasks block workspace completion. Completing a workspace hides it
from active navigation but does not stop its workspace sessions, delete its
home folder, or alter task/session history. A completed workspace can be
reactivated explicitly before a new task or workspace session is created.
Reactivation does not reopen any completed task.

### 14.2 Quick Request promotion

Promotion moves a Quick Request task into a user-selected existing workspace,
or into a new regular workspace created during promotion. The task keeps its
identity, sessions, and history. The task stops being governed by Quick Request
expiry. Earlier sessions retain the shared Quick Request directory; future
sessions use the promoted task's dedicated home folder and worktree context.

### 14.3 Quick Request expiry

Expiry is based on creation time and is never extended by follow-ups. Expiry
does not terminate an OpenCode process or delete history. A running or
input-waiting request remains visible until its current execution reaches a
stable state. Once inactive, an expired request leaves active navigation and
remains available in history.

### 14.4 Repository checkout placement

An existing repository remains at its current path by default. The workspace
binding records that path as the workspace's main-branch inspection context.
When the application creates a managed main checkout, it uses:

```text
<workspace-home>/repos/<repository-name>/
```

The binding records which mode is in use and always records the canonical path,
repository identity, and main branch.

### 14.5 Branch and worktree authority

OpenCode performs task setup through its normal Git/tool execution. It reports
the result through the registration tool. Rust does not trust the report until
it independently validates the repository identity, branch, path, ownership,
and Git worktree state. A failed or rejected report leaves the task in setup
incomplete state and does not create an authoritative association.

### 14.6 Incomplete setup

Task setup is itemized. A task with one or more failed or not-attempted
repository items remains active but is marked setup incomplete. Retries reuse
the task and operation records and do not create a second task. Git artifacts
created before a failure are retained until a later explicit cleanup operation
can prove that removal is safe; the application never removes them as an
implicit consequence of reporting failure. The user may cancel an in-progress
setup operation; cancellation records the event, leaves the task setup
incomplete, retains its artifacts, and requires an explicit resume to continue.

### 14.7 Repository purpose generation

Repository discovery uses an OpenCode discovery session to generate a concise
purpose from verified repository facts. Rust stores the generated text with the
catalog entry. If generation fails, the repository remains in the catalog with
an unavailable-purpose state and can be described later; repository identity
and location do not depend on model output.

### 14.8 Pending input notification

The GUI provides both a session status indicator and a pending-input list.
Selecting an item focuses the exact session's terminal. The list covers
permissions, approvals, forms, and other OpenCode input requests. Answering
always occurs through the real TUI and is associated with that session ID.

### 14.9 Sessions after task completion

Completing a task does not stop its OpenCode sessions. Active sessions continue
until they finish or the user quits the application. Worktree cleanup is
deferred while any session uses the worktree. A completed task is never
reopened; later implementation work is a new task.

### 14.10 Names and filesystem slugs

Workspace and task IDs are immutable unique identifiers. Display names may be
reused, but filesystem slugs must be unique within their parent. A collision
gets a deterministic numeric suffix, while the display name remains unchanged.

### 14.11 Filesystem permission boundary

Rust accepts repository paths that are inside the project home or that the user
has explicitly selected and placed in the repository catalog. Paths are
canonicalized before validation. Registration reports cannot introduce an
unselected repository or escape an owning task's allowed worktree location.

### 14.12 Terminal integration conformance

The shared terminal runtime must provide these behaviors:

- Use the installed, version-checked OpenCode server and TUI contract. For
  v2.0.27, use the app-owned `serve` child, authenticated `/api/info` and
  `/api/session` routes, and root TUI `--server`/`--session` options; do not use
  v1 `attach` or unprefixed `/session` routes.
- Attach every TUI by exact session ID and working directory.
- Register Tauri event listeners before enabling session actions.
- Answer the xterm.js XTGETTCAP query with the supported DCS matcher.
- Stream PTY bytes through the session-specific terminal view.
- Restore history without sending a new prompt.
- Keep PTYs and server processes alive when a view or window is hidden.
- Stop and wait for app-owned children on full application quit.
