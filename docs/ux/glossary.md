# UX Glossary

Use these terms consistently in user-facing copy, UX specifications, and product
discussions. For workflow behavior beyond the UX vocabulary, see
[`../application-workflows.md`](../application-workflows.md).

## Work and context

- **Workspace:** A project grouping that knows about zero or more repositories
  and may contain zero or more tasks. Its repository associations are working
  context; existing repositories stay where they are unless the user explicitly
  chooses otherwise.
- **Task:** An optional, independently progressing unit of work nested under one
  workspace. A task may use one or more repositories associated with that
  workspace. Its worktrees belong in the task's defined worktree locations
  (`<task-home>/worktrees/` for managed task worktrees).
- **Quick Request:** A named one-off tracked item under the special Quick
  Requests workspace. It is important work with its own status and lifecycle,
  not a generic label for a user's text or an OpenCode interaction.
- **Prompt:** Text supplied to OpenCode. Call the initial user text the
  **original prompt** and text prepared for a new session the **starting
  prompt**. A prompt is not itself a product record; Quick Requests retain their
  original prompt as a field on the tracked request.
- **Repository context:** The repositories known to a workspace and the subset
  selected or associated for a task. Show relevant repository context before
  work begins; it informs setup and worktree placement.

## OpenCode interaction

- **OpenCode session:** One OpenCode conversation, with history owned by
  OpenCode. Except for the internal proposal step in New work, a session runs
  attached to an interactive terminal.
- **Interactive terminal:** The user's live interface to an OpenCode session or
  interactive tool process. Users watch progress and handle follow-ups,
  approvals, input, and changes there. The terminal is not an app-rendered
  transcript or a background-only process.
- **Terminal tab:** The application entry for an attached interactive terminal.
  Tabs belong to a workspace, task, or Quick Request. Switching to another
  destination keeps the tab and process open; closing the tab stops its process.

## Other workbench destinations

- **Change Review:** The single name for the repository-diff destination. Use it
  in toolbar labels and prose. Change Review is separate from OpenCode's
  interactive terminal.
- **Docs reader:** The destination for reading discovered Markdown and text
  files by paths relative to their Workspace or repository source. It is not a
  general file browser or editor.
- **Tools menu:** The menu of repository-scoped tools available for the selected
  workspace or task context.

## Avoid as product vocabulary

- **Request** by itself: ambiguous. Use **Quick Request** for the tracked item
  and **prompt** for text.
- **View** by itself: too generic to identify a destination. Name the thing:
  **interactive terminal**, **Change Review**, or **Docs reader**.
