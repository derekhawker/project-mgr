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
┌ agentic-frontend ▾ │ Project │ Upgrade tonic-one │ + Task │ Change Review ┐
│ test · terminal ▾ │ + Session │ Shell │ READMEs │ Tools │ ⛶ Fullscreen   │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                Selected terminal or workbench destination                 │
└───────────────────────────────────────────────────────────────────────────┘
```

- The first row identifies the selected workspace and switches among its tasks.
  The workspace remains visible even when it has tasks. Keep task navigation
  available while a terminal is active.
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
  controls such as fullscreen in the compact toolbar above it. The terminal and
  its work area have no inset padding.
- The terminal viewport stretches to fill all remaining window height below the
  compact workbench toolbars. Its flex ancestors and terminal-view container
  must allow the terminal surface to grow and shrink with the window.
- Provide a fullscreen control in the terminal bar. Fullscreen expands the
  terminal to the available window and hides navigation and non-terminal chrome;
  provide a clear control to exit fullscreen.
- Do not show a persistent application-status panel, command-result dump,
  environment badge, decorative brand icon, or footer. Show actionable errors
  inline where they occur; keep ordinary connection state out of the work area.
- **New** opens the New-work modal above the current view. It must not replace
  the selected workspace/task or reset its active terminal. After confirmation,
  the new workspace becomes selected and its new OpenCode session opens in an
  interactive terminal.

## Terminal tabs and ownership

- Each workspace and each task has its own set of terminal tabs. Do not mix tabs
  between owners.
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
- Give each terminal tab an explicit close control; closing removes only that
  session's terminal and leaves other owner tabs running.
- Workspace/task OpenCode session tabs are named **OpenCode**; the selected
  workspace or task is already identified in the owner bar.

## Workspace and task behavior

- A workspace can have no repos and no tasks and still be useful through its own
  OpenCode session.
- A workspace knows about zero or more repositories. Task proposals use that
  context, and task worktrees are created in the task's defined worktree
  locations. Change Review uses the task's recorded repository/worktree context.
- Workspace-level tools use workspace context or a selected associated repo.
- After New-work confirmation, the reviewed starting prompt is sent through the
  newly created workspace session automatically. The workspace tracks that
  session for later navigation and restoration.
- Show the workspace's attached repository names, branches, and verification
  states in the selected workspace and task context; keep catalog scanning and
  attachment controls workspace-only.
- Keep completed-work history out of the active task/workspace toolbar for now;
  History remains a disabled menu option.

## Empty state

If there is no selected owner, show only: **“Select a workspace or task, or
choose New to start work.”** This is a rare fallback, not a dashboard.
