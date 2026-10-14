# Workspace and Task Workbench

## Purpose

The workbench is the main application surface. A workspace represents a project
and remains a complete working context whether or not it has tasks. Tasks are
optional, directly nested under the workspace, and are often where parallel
implementation work happens.

## Layout

Use two simple wrapping toolbar rows above one full-size main view:

```text
┌ agentic-frontend │ Project │ Upgrade tonic-one │ Review comments │ + Task ┐
│ Session │ test · terminal │ Shell │ Changes │ READMEs │ Tools               │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                    Selected terminal or selected view                     │
└───────────────────────────────────────────────────────────────────────────┘
```

- Row one switches among the workspace itself and its tasks. It wraps rather
  than hiding tasks behind an overflow control. The workspace remains visible
  even when it has tasks.
- Row two contains the selected owner's interactive terminal tabs and available
  non-terminal views. It also wraps; visibility takes precedence over a single
  toolbar line.
- `Changes` appears only when the selected workspace/task has an associated
  repository. `READMEs` appears when one or more README files are found.
- `Tools` opens a menu. With at most two repositories, show their tool groups
  side by side in the menu, not as a vertical sequence of repo submenus.
- The selected terminal or view occupies the remaining work area. Do not reserve
  a permanent side panel for notes, task lists, or tool output.

## Terminal tabs and ownership

- Each workspace and each task has its own set of terminal tabs. Do not mix tabs
  between owners.
- Tabs are remembered while the app remains open; restoring the tab arrangement
  after app shutdown is not required.
- OpenCode sessions and interactive tool terminals use the same full-size
  terminal area. Running a script opens a new interactive terminal tab.
- Terminal controls and process lifecycle belong to the interactive terminal.
  Closing a terminal stops its process and closes its tab. Switching to another
  terminal, Changes, or READMEs does not itself close a tab.
- Terminal tab names should identify the context/action (for example,
  `tonic-one · test` or `Shell · agentic-frontend`).

## Workspace and task behavior

- A workspace can have no repos and no tasks and still be useful through its own
  OpenCode session.
- A task may span multiple repos. Its tools and change review use the task's
  recorded repo/worktree context.
- Workspace-level tools use workspace context or a selected associated repo.
- Keep completed-work history out of the active task/workspace toolbar for now;
  History remains a disabled menu option.

## Empty state

If there is no selected owner, show only: **“Select a workspace or task, or
choose New to start work.”** This is a rare fallback, not a dashboard.
