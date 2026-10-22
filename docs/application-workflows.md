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

Rust creates and validates Workspace clones, Task branches/worktrees, and their
associations before opening user-facing sessions. OpenCode owns conversation
history and performs requested implementation work; it does not provision
application-managed repositories or worktrees.

## 2. Actors

| Actor | Responsibility | Does not own |
|---|---|---|
| User | Chooses work, supplies prompts, reviews results, answers requests, and changes lifecycle state. | Direct database, process, or Git bookkeeping. |
| GUI | Renders navigation, forms, status, terminal views, history, and lifecycle controls. Sends explicit commands to Rust. | OpenCode history, authoritative associations, or filesystem validation. |
| Tauri/Rust core | Owns application commands, validation, SQLite writes, OpenCode child processes, PTYs, event forwarding, recovery, and cleanup scheduling. | Conversation content or model decisions. |
| SQLite management store | Persists workspaces, tasks, repositories, associations, sessions, settings, lifecycle state, and cleanup state. | Notes, resources, Git history, or duplicate conversation transcripts. |
| Filesystem | Stores workspace/task home folders, notes, resources, and the default Quick Request directory. | Lifecycle truth for records; SQLite remains authoritative for management state. |
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
- Workspace repository bindings, source identities, and independent clone paths.
- Task repository bindings, branches, and worktree paths.
- OpenCode session IDs, session owners, working directories, and last-known
  status.
- Quick Request creation time and original prompt; deletion removes the app-owned
  request/prompt/session association while preserving OpenCode conversation data.
- Original Quick Request prompts in a dedicated task-linked table; regular
  workspace/task prompts remain transient inputs.
- Cleanup jobs, attempts, deferrals, and failure details.
- User preferences, including the project-home root.

SQLite does not store a second copy of conversation messages. The sole prompt
exception is a Quick Request's original prompt, stored in a dedicated table
linked to its request so the full list can display it without reading OpenCode
history. Workspace/task original and starting prompts remain transient.

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

Existing source repositories remain at their current locations. New Workspace
attachments are independent clones under that Workspace's `repos/` directory;
the catalog continues to identify the source checkout. Existing bindings keep
their recorded checkout paths and are not rewritten by migration.

### 3.3 Quick Requests

Quick Requests are tasks under a special workspace and do not get individual
home folders. Each request uses the working directory resolved from a registered
repository; when none is identified, it uses the shared `Quick Requests/` folder
under the configured OpenCode Projects root (normally `~/OpenCode Projects/`).
This shared folder is a deliberate exception to regular workspace/task home
placement, not a temporary directory. Changing the configured root updates the
shared Quick Requests workspace/task paths; existing session working directories
remain exact and are still restorable. Their management records and session IDs
belong in SQLite. In the GUI, show requests created
in the last 24 hours in the top Quick Requests section of persistent navigation.
The separate full-list destination shows all retained Quick Requests, including
older items. Each row has an **Open** button beside non-clickable prompt text and
one **Delete** action with confirmation. Opening one
shows its dedicated page: the terminal fills the available main work area, the
app shell/navigation remain visible, and there are no session tabs or
workspace/task controls. **Back to Quick Requests** returns to the list without
closing the terminal or stopping its process.

## 3.4 Navigation and workspace focus

Keep the Workspace → Task tree prominent in persistent left navigation. Show
all open workspaces, including idle ones, with tasks nested directly under their
workspace. Do not require a separate all-workspaces summary screen: selecting a
workspace renders its working area in the main pane. Provide a **New work**
dropdown in navigation. Its choices start workspace, task, or Quick Request
flows; do not put a work-type selector inside the prompt form. The Task flow
always shows a Workspace selector. Right-clicking a Workspace in the navigation
tree also offers **New Task**, with that Workspace preselected in the same
selector; the user may change it. Do not provide a separate name-first workspace
path or a standalone **+ Task** button.
In a selected workspace, keep available controls compact and give the
interactive OpenCode terminal almost all of the main/right pane.
The selected workspace and its tasks show the verified workspace repository
bindings, including checkout path, branch, and verification state; the catalog
and attachment controls are available at workspace scope.
Show the Quick Requests section above the workspace tree. Put **See all Quick
Requests** above the recent requests list.

## 4. Core Invariants

1. The hierarchy is exactly `Workspace -> Task`.
2. Every task belongs to exactly one workspace.
3. Quick Requests are tasks under the special Quick Requests workspace.
4. A task may use multiple repositories and multiple sessions.
5. A workspace with zero repositories has one workspace-home session; one
   repository has one clone-rooted session; multiple repositories have one
   empty clone-rooted session per repository.
6. Each task repository has an independent task worktree and an empty OpenCode
   session rooted at that worktree; there is no task-home coordinator session.
7. A task's sessions are coordinated by the user across separate interactive
   terminals; each session is associated with both the task and its repository.
8. OpenCode owns conversation history; SQLite stores associations only.
9. Regular workspace/task original and starting prompts are transient command
   inputs. The application does not persist them in SQLite or files; OpenCode
   owns any submitted conversation history. A Quick Request's original prompt is
   the explicit exception: SQLite stores it in `quick_request_prompts`, linked
   to its task, while OpenCode continues to own the conversation history.
10. A new session means a new OpenCode conversation in the same owner context;
   it does not create a child task.
11. Completed tasks cannot be reopened. Further work starts as a new task.
12. Completing a task does not commit, merge, or discard code.
13. A workspace cannot be completed while it has active tasks.
14. A completed task's clean worktree is removable only when no session uses it.
15. Removing a worktree never removes its branch.
16. Dirty worktrees and worktrees containing new files remain in place.
17. Hiding a terminal view or the main window does not stop OpenCode work.
18. Full application quit stops app-owned TUI and server children.
19. A failed event subscription, session creation, PTY attachment, or required
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

If OpenCode's authenticated session lookup returns HTTP 404, Rust creates a new
empty session in the same owner directory using the configured app default
model, persists it, and attaches its interactive terminal. Task replacements
retain the same Task/repository association. The stale record is marked missing
and is not restored again; its OpenCode history is not deleted. A completed
Task cannot receive a replacement session. Network, authentication, server,
validation, and terminal-attachment failures are not treated as a missing
session and remain visible errors. Replacement never submits a prompt.

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

Global pending-input refresh checks current tracked sessions only. Session
records retired as `missing` are excluded, and an OpenCode HTTP 404 for any
session is treated as having no pending input for that session; it must not
prevent pending-input state for other sessions from loading. Other API errors
remain visible. A later successful refresh clears the matching
pending-input-unavailable notice without clearing unrelated startup or recovery
notices.

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

### 7.1 Add user-selected repository directories

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Opens **Directories** from top navigation and uses **Add directories** to select one or more folders with the native folder picker. | The GUI sends only those explicit paths to Rust. |
| 2 | Rust | Canonicalizes and validates readable directories; discovers Git repositories while excluding the configured OpenCode Projects root. | Candidate Git repositories are identified without changing them; the managed project tree is never scanned. |
| 3 | Git | Reports repository roots, remotes, branches, and identity data. | Rust has verifiable repository facts. |
| 4 | Rust | De-duplicates candidates against the repository catalog by verified identity and canonical path; linked worktrees do not become separate catalog entries. | Existing repository identities are reused rather than duplicated. |
| 5 | OpenCode | Generates a concise purpose description from repository content or metadata when requested by the discovery flow. | The description is proposed content, not repository identity. |
| 6 | User | Reviews or edits the purpose description. | The catalog stores the accepted concise purpose. |
| 7 | Rust | Writes the repository catalog entry and discovery result to SQLite. | The shared catalog is additional context to any New-work proposal; discovery alone does not attach a repo to a workspace. |

Saved scan roots persist and startup rescans each root. Repository identities
discovered under overlapping roots are shown only once under the most-specific
root. Individual repository checkboxes persist enabled/disabled state. Only
enabled repositories are included in the initial New-work proposal context and
can be selected as a Quick Request working directory; the user's original
prompt remains unchanged.

The configured project-home root is a hard scan exclusion: Rust rejects a
selected path inside it and prunes it when a selected ancestor contains it.
OpenCode receives the catalog as proposal context, but model output cannot
replace Rust's verified path or repository identity.

### 7.2 Attach a repository to a workspace

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Confirms a catalog repository in a new-work proposal. | Rust receives its verified catalog ID, not an arbitrary path or Git command. |
| 2 | Rust | Revalidates source identity, clean state, default branch, and configured upstream fetch URL. | Stale or dirty sources are rejected before provisioning. |
| 3 | Rust/Git | Creates an independent clone at a stable path under `<workspace-home>/repos/`, recursively initializes submodules, and validates the result. | The source checkout remains unchanged; the workspace owns its clone. |
| 4 | Rust | Persists source and clone identities, exact paths, branch, and setup outcome. | Future operations use recorded paths and validated identities. |
| 5 | Rust | Sets the workspace clone's `origin` to the source's configured upstream fetch URL, or removes the local-path origin when none exists. | The clone does not retain the source checkout as its parent remote. |

Cloning uses `git clone --no-hardlinks --recurse-submodules`. Git's standard
relative submodule URL resolution is used. Recursive submodule failure leaves
an explicit incomplete setup; do not fetch Git LFS objects. Existing workspace
bindings are not rewritten by this new-work provisioning behavior.

### 7.3 New-work proposal and confirmation

**New** opens a modal over the current destination and captures the original
prompt. Rust sends it to an internal, request/response-only OpenCode proposal
step. This is the one exception to the rule that OpenCode sessions use an
interactive terminal. The proposal step does not create a terminal tab, product
record, repository change, or normal session association.

For a Workspace, the proposal returns the proposed name, description, selected
repository IDs and reasons. Rust validates the proposal before showing it for
confirmation. The user may edit the workspace name; the form also shows the full
planned home path, which remains fixed when the display name changes. Repository
locations appear as a compact name-and-path list. OpenCode's revised prompt
pre-fills the single editable starting-prompt field; it is not replaced by the
original prompt, and there is no separate proposed-prompt section. For a Task,
the proposal returns task name/purpose and repository IDs selected only from the
workspace's attached clones. Review shows the selected Workspace and Task home
location; the user can edit the Task name, intent, and optional revised prompt.
The original prompt remains read-only. The revised Task prompt is optional
reference text only: it is never sent to a Task session or persisted. The
original prompt is transient extraction/review input and is not sent to task
sessions.

For a Workspace, confirmation provisions selected clones before
creating sessions. With zero repositories, Rust creates one session rooted in
the workspace home; with one repository, one session rooted in its clone; with
multiple repositories, one empty session per repository clone. Only the zero-
and one-repository cases receive the confirmed starting prompt automatically.
Multi-repository workspaces receive no prompt fan-out. Task confirmation creates
task worktrees and one empty session per selected repository, rooted in its
worktree; no prompt is sent automatically.

If workspace setup or session startup fails, keep the durable workspace and show
the failed step and details in the New-work dialog with an explicit retry.
Do not leave setup progress, a routine “setup ready” message, or a setup report
on the selected Workspace or Task page. Keep actionable terminal/restore errors
visible inline and do not overwrite them with routine setup refreshes. Navigating
to a workspace later restores all exact tracked sessions rather than selecting
the newest session in a directory. If a terminal process exits, offer restart
for that same session and directory without submitting a prompt.

Task creation uses the same capture-and-review flow from a selected workspace.
The internal proposal uses the attached workspace clone context to identify
task repositories. On confirmation Rust creates task worktrees and one empty
interactive session per selected repo. The user coordinates across those
sessions and enters prompts manually. A task with no selected repositories has
no repo session or terminal until a supported session can be started.

## 8. Workspace Workflows

### 8.1 Create a workspace through New

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **New** and enters a prompt describing the workspace. | The GUI preserves the original prompt and disables duplicate submission. |
| 2 | GUI | Sends the creation command to Rust. | Rust owns the transaction. |
| 3 | Rust | Normalizes the name into a safe display name and filesystem slug, checking collisions. | The chosen workspace has stable identity and path. |
| 4 | Rust | Creates the workspace row in SQLite and its home, `notes/`, `repos/`, and `tasks/` directories. | Filesystem and management record are created together or the operation fails visibly. |
| 5 | Rust | Initializes the workspace as active with no tasks and no repository bindings. | The workspace appears in the persistent workspace navigation, even with no tasks. |
| 6 | Rust/GUI | Provisions selected clones; creates one workspace-home session for zero repos, one clone-rooted session for one repo, or one empty clone-rooted session per repo for multiple repos. | Each workspace terminal has the correct repository context; multi-repo setup opens one tab per repo and sends no prompt automatically. |

A workspace may have no repositories or tasks. Creating it through New starts
its workspace session(s) automatically; a multi-repository workspace starts
empty per-repository sessions and receives no automatic starting prompt. It does
not create a task.

### 8.2 Start or restore a workspace planning session

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Selects a workspace. | The GUI resolves the workspace's exact stored session. |
| 2 | Rust | Resolves the workspace-home directory for zero bindings, one clone for one binding, or each clone for multiple bindings. | OpenCode receives stable workspace/repository context, not a task worktree. |
| 3 | Rust | Creates or restores every tracked workspace session at its exact directory. | Each repository tab belongs to the workspace and its exact repository. |
| 4 | OpenCode | Inspects workspace context and edits workspace notes or requirements when requested. | Planning work stays at workspace scope. |
| 5 | User | Follows up in the selected terminal. | The workspace session remains tracked; repository tabs remain independent. |

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
| 1 | User | Chooses **Task** from the navigation's **New work** dropdown while a workspace is selected and enters the original task prompt. | The workspace context is passed separately; the prompt is preserved exactly. |
| 2 | Rust/OpenCode | Interprets the prompt in a transient proposal step using the workspace clones. | A task proposal and repository selection are returned without creating a task or terminal. |
| 3 | User | Reviews the proposed task, repository selection, and expected effects. | The user can go back and submit a different original prompt; no task starting prompt is generated. |
| 4 | User | Confirms the proposal. | Rust receives the exact confirmed task context. |
| 5 | Rust | Verifies the workspace is active and creates the task row and task home, `notes/`, and `worktrees/` directories. | The task has a stable owner and working directory. |
| 6 | Rust | Persists the exact confirmed repository selection with the task. | Retry cannot silently widen or replace its context. |
| 7 | Rust/Git | Creates each deterministic task branch/worktree from its workspace clone and recursively initializes pinned submodules. | Task worktrees are independent, validated Git roots. |
| 8 | Rust | Persists each setup result, then creates one empty session per selected repository at its task worktree and associates it with that repository and task. | Every terminal is rooted in exactly one repo worktree; no original or generated prompt is submitted. |
| 9 | Rust/GUI | Opens the repo sessions as separate interactive terminals and reports any partial startup failure. | Successful sessions remain usable and failed items remain visible/recoverable. |
| 10 | User/OpenCode | Coordinates across terminals and manually enters work prompts. | Each conversation and repository's changes remain independently scoped. |

Rust owns task branch, worktree, and session setup. OpenCode performs requested
implementation work only after the user enters it in the matching repo session.

### 9.2 Task setup with multiple repositories

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | Rust/Git | Sets up each selected repository independently from its workspace clone. | A failure in one repository does not erase successful results for others. |
| 2 | Rust | Checks branch collisions, existing worktrees, repository identity, path containment, and task ownership. | Unsafe or ambiguous worktrees are rejected. |
| 3 | Rust | Stores successful associations and an itemized failure record for each unsuccessful repository. | The task has an explicit setup report. |
| 4 | Rust/OpenCode | Creates one empty repo-rooted session for each successfully set-up repository and records its repository association. | Partial session startup does not discard other usable sessions. |
| 5 | GUI | Shows ready, failed, and pending repositories/sessions separately. | The user can retry or adjust only affected items. |

### 9.3 Partial task setup failure

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | Git/OpenCode | A clone, submodule, branch, worktree, or session startup operation fails. | The failure includes the repository and attempted operation. |
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
| 2 | User | Chooses a repository associated with the task. | The new session is assigned to that repository's task worktree. |
| 3 | Rust | Creates a new OpenCode conversation at the exact worktree and records task, repo, session ID, and directory. | Existing session history remains separate and intact. |
| 4 | OpenCode/TUI | Opens the new repo-rooted interactive terminal without an initial prompt. | The user can coordinate it with other repo sessions. |

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
| 1 | User | Chooses **Quick Request** from the New work dropdown and enters an original prompt. | The shared New-work modal preserves the current destination. |
| 2 | GUI/Rust/OpenCode | Runs the internal proposal whose sole purpose is to resolve a working directory from the registered repository catalog. | Rust validates the repository and exact path; no record or terminal is created. |
| 3 | User | Reviews or corrects the resolved directory using a registered repository, then confirms. If no repository is identified, the proposed directory is `<configured OpenCode Projects root>/Quick Requests/`. | The original prompt remains unchanged; no workspace choice or starting-prompt rewrite is involved. |
| 4 | Rust | Ensures the special Quick Requests workspace, resolved directory, and app-owned OpenCode server are ready. | The working directory is the identified repository or shared default. |
| 5 | Rust | Creates the Quick Request task, stores its original prompt in `quick_request_prompts`, and records the OpenCode session ID, working directory, and creation time in one transaction. | The request and its exact prompt/session association are durable; the task's generic description remains unused. |
| 6 | Rust/GUI | Attaches the exact session in a PTY and opens its dedicated Quick Request page. | The terminal fills the available main work area; app navigation remains visible and no session tabs or workspace/task controls are shown. |
| 7 | Rust | Sends the original prompt unchanged through the session. | Generation starts in the matching TUI. |
| 8 | OpenCode/TUI | Streams output, handles tools, and asks for approval/input when needed. | The user can interact in the same terminal. |
| 9 | Rust/GUI | Stores status and emits output without copying transcript content into SQLite. | The request remains associated and recoverable. |
| 10 | Rust/GUI | Applies the 24-hour creation-time cutoff to recent navigation; follow-ups do not reset it. | Older requests remain in the full Quick Requests list. |

The proposal is transient: cancellation or proposal failure creates no Quick
Request. Confirmation follows the common session startup flow and must not claim
success if creation, attachment, or initial prompt delivery fails.

### 10.2 Follow up on a Quick Request

The user enters the follow-up directly in the already attached TUI. The common
follow-up flow sends the input to the same session ID. The GUI does not create a
new Quick Request or call the initial-prompt endpoint again.

### 10.3 Delete a Quick Request

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | User | Chooses **Delete** beside a Quick Request. | The GUI asks for confirmation before making changes. |
| 2 | User | Confirms deletion. | The GUI removes the Quick Request from its current list. |
| 3 | Rust | Closes its attached terminal, then transactionally removes its app record, prompt, and session association. | The request is no longer retained by the app; OpenCode's conversation remains. |

The application requires explicit confirmation. Cancel leaves the request
untouched. Search is deferred to Deliverable 3.

### 10.4 Quick Request recent-list cutoff

| Step | Actor | Action | Result |
|---:|---|---|---|
| 1 | Rust/GUI | Selects recent navigation items by creation time within the last 24 hours. Follow-ups do not reset the age. | Older items are not in recent navigation. |
| 2 | Rust/GUI | Shows every retained Quick Request in the full list regardless of age. | Older requests remain discoverable without a separate History destination. |

The 24-hour cutoff is a presentation filter. It does not terminate a process,
change the request's execution status, or delete data.

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
5. If the initial prompt fails, Rust records the session failure, returns an
   actionable error, and appends failure metadata to the OS-specific application
   log. Prompt text is neither persisted by the application nor logged.

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
| Create or restore workspace session | User/GUI | Rust for association; OpenCode for conversation | Common session runtime |
| Create task record and home | User/GUI | Rust + SQLite + filesystem | Tauri command |
| Select task repositories | User/GUI | Rust validates selected workspace bindings | Task proposal/confirmation command |
| Create branch/worktree | Rust | Rust + Git + SQLite | Validated deterministic Git operations |
| Create repo-rooted task session | Rust | Rust + OpenCode + SQLite | Common session runtime with exact worktree directory |
| Complete task | User/GUI | Rust + SQLite | Tauri command |
| Clean completed worktree | Cleanup worker | Rust + Git | Background app operation |
| Complete workspace | User/GUI | Rust + SQLite | Tauri command |
| Follow up or answer input | User/TUI | OpenCode | PTY input |
| Report running/waiting/completed | OpenCode events/API | Rust reconciler | Server events and status API |
| Delete Quick Request | User/GUI | Rust + terminal runtime + SQLite | Confirmed Tauri command |

### 13.1 Legacy registration tool contract

The existing registration tool reports setup performed by the current
model-driven Task flow. The provisioning design removes it from Task setup:
Rust will own selection validation, Git side effects, and persistence directly.
Do not extend this reporting contract for new Workspace clones or Task
worktrees; remove/deprecate the task setup command and tool as part of the
vertical migration once no production path depends on them.

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

### 14.2 Quick Request deletion

Deletion requires user confirmation. It closes any attached terminal and removes
the Quick Request's task, original prompt, and local session association from the
application database. It does not delete the OpenCode conversation or transcript.
Canceling the confirmation changes nothing.

### 14.3 Quick Request recent-list cutoff

Recent navigation is based on creation time and is never extended by follow-ups.
At 24 hours a request leaves recent navigation and remains in the full Quick
Requests list until the user deletes them. This presentation cutoff does not
terminate a process or delete the request.

### 14.4 Repository checkout placement

The repository catalog records the user-selected source checkout. New Workspace
attachments are independent clones under:

```text
<workspace-home>/repos/<stable-repository-directory>/
```

The Workspace binding records both source identity/path and clone identity/path,
plus the verified default branch. The source remains untouched. Existing
Workspace bindings retain their recorded paths; the clone policy applies to new
attachments.

### 14.5 Branch and worktree authority

Rust creates task branches and worktrees from the validated Workspace clone,
initializes recursive pinned submodules, validates repository identity, branch,
path, ownership, and Git worktree state, and persists the result before creating
repo-rooted task sessions. OpenCode does not provision Git state or report
authoritative setup. Each task session is associated with both its Task and
repository binding.

### 14.6 Incomplete setup

Workspace clone and Task worktree/session setup are itemized. A task with one or
more failed repository items remains active but is marked setup incomplete.
Successful clones, worktrees, and sessions are retained; retries reuse verified
state and do not create a second task or duplicate session for a completed item.
Git artifacts created before a failure are retained until cleanup can prove
removal is safe. Task sessions are created empty. Original prompts used to
propose task metadata and optional revised Task prompts shown during review are
transient, never persisted or logged, and never automatically sent to sessions.

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
