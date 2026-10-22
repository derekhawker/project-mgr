# Workspace and Task Workbench

## Purpose

The workbench is the main application surface. A workspace represents a project
and remains a complete working context whether or not it has tasks. Tasks are
optional, directly nested under the workspace, and are often where parallel
implementation work happens.

## Layout

Keep the app shell anchored to the window. The left navigation stays fixed;
only the selected main pane scrolls. Keep the task/session bar compact above a
full-size terminal:

```text
┌ agentic-frontend ▾ │ Project │ Upgrade tonic-one │ Change Review ┐
│ test · terminal ▾ │ + Session │ Shell │ READMEs │ Tools               │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                Selected terminal or workbench destination                 │
└───────────────────────────────────────────────────────────────────────────┘
```

- The first row identifies the selected workspace and switches among its tasks.
  The workspace remains visible even when it has tasks. Keep task navigation
  available while a terminal is active.
- Create a workspace or Task from the **New work** dropdown in the persistent
  left navigation. Do not add a standalone **+ Task** toolbar button.
- Right-clicking a Workspace in navigation offers **New Task**. That action
  opens the shared Task prompt form with the clicked Workspace preselected.
  The Task form always shows a Workspace selector, including for this contextual
  entry point, and the user may change the selection before continuing.
- The second row shows the selected owner's terminal tabs, session actions, and
  available destinations. Keep it compact; do not let wrapping toolbars consume
  the terminal's area.
- `Change Review` appears only when the selected workspace/task has an associated
  repository. `READMEs` appears when one or more README files are found.
- `Tools` opens a menu. With at most two repositories, show their tool groups
  side by side in the menu, not as a vertical sequence of repo submenus.
- The selected terminal occupies the entire work area below the task/session
  bar. Do not place owner descriptions, repository management, status messages,
  notes, or other unrelated controls around an active terminal.
- The terminal card is only the terminal viewport: no header, status or pending
  input widgets, card background, border radius, margin, or padding. Put terminal
  controls in the compact toolbar above it. The terminal and its work area have
  no inset padding.
- The terminal viewport stretches to fill all remaining window height below the
  compact workbench toolbars. Its flex ancestors and terminal-view container
  must allow the terminal surface to grow and shrink with the window.
- Do not provide a fullscreen/expand control. Keep the normal application shell
  and navigation visible everywhere.
- Do not show a persistent application-status panel, command-result dump,
  environment badge, decorative brand icon, or footer. Show actionable errors
  inline where they occur; keep ordinary connection state out of the work area.
- **New** opens the New-work modal above the current view. It must not replace
  the selected workspace/task or reset its active terminal. After confirmation,
  the new workspace becomes selected and all sessions required by its
  repository count open in interactive terminal tabs.

## Terminal tabs and ownership

- Each workspace and each task has its own set of terminal tabs. A multi-repo
  workspace and a multi-repo task each have one tracked OpenCode session per
  selected repository. Workspace sessions use their workspace clones; Task
  sessions use their task worktrees. Do not mix tabs between owners or repos.
- Tabs are remembered while the app remains open; restoring the tab arrangement
  after app shutdown is not required.
- Except for the internal New-work proposal step, every OpenCode session runs in
  an attached interactive terminal in the same full-size terminal area. The
  user watches progress and handles follow-ups, approvals, and changes there;
  do not render OpenCode conversation as a separate app transcript. Navigating
  to a workspace or task opens or restores its exact tracked session.
- Terminal controls and process lifecycle belong to the interactive terminal.
  Closing a terminal stops its process and closes its tab. Switching to another
  terminal, Change Review, or READMEs does not itself close a tab.
- If the TUI process exits (including Ctrl+D), keep the tracked session tab and
  show **Restart terminal**. Restart the TUI with the same OpenCode session ID
  and exact working directory. Do not create a new conversation or send a prompt
  when restarting.
- If OpenCode confirms a tracked session no longer exists, open a fresh empty
  session in the same Workspace or Task repository context. Do not reuse the
  missing ID or send a prompt; preserve the old OpenCode history. Do not create
  replacement sessions for completed Tasks. Other restore failures remain
  actionable errors.
- Give each terminal tab an explicit close control; closing removes only that
  session's terminal and leaves other owner tabs running.
- Workspace/task OpenCode session tabs are named **OpenCode**; the selected
  workspace or task is already identified in the owner bar.

## Workspace and task behavior

- A workspace can have no repos and no tasks and still be useful through its own
  OpenCode session.
- A workspace knows about zero or more repositories. Task proposals use that
  context, and each new attachment is an independent clone under the workspace
  home. With zero repositories, open one workspace-home session. With one
  repository, open one session in its clone. With multiple repositories, open
  one empty session per repository clone. The multi-repository workspace must
  not create a generic workspace-home session or submit the starting prompt to
  any repository session automatically.
- Rust creates each task repository's branch and worktree from its workspace
  clone, then creates an empty session rooted at the task worktree. Task prompts
  are not sent automatically. Users coordinate across the repo terminals and
  manually enter prompts. Change Review uses the task's recorded
  repository/worktree context.
- Creating another Task session requires choosing one of that Task's ready
  repository IDs. Rust roots the empty conversation in that repository's task
  worktree; the user sends any work prompt manually.
- Workspace-level tools use workspace context or a selected associated repo.
- Show setup progress only in the New-work dialog while creation is running.
  Do not leave a progress list, routine “setup ready” message, or setup report
  on the selected Workspace or Task page after the tabs. A failed step and its
  details remain in the dialog; actionable terminal/restore errors remain
  visible inline and must not be overwritten by a routine setup refresh.
- For zero/one-repository workspaces, preserve the reviewed starting-prompt
  behavior. For multiple repositories, do not automatically submit the prompt;
  leave every repo-rooted terminal empty for the user to direct manually.
- Show the workspace's attached repository names, branches, and verification
  states in the selected workspace and task context. Shared repository
  directories and catalog scanning live at the top of navigation, not inside
  workspace management. A catalog entry becomes a workspace association only
  when a proposal is confirmed or the user explicitly attaches it.
- Keep completed-work history out of the active task/workspace toolbar for now;
  History remains a disabled menu option.

## Empty state

If there is no selected owner, show only: **“Select a workspace or task, or
choose New to start work.”** This is a rare fallback, not a dashboard.
