# UX Glossary

> **Refactor in progress:** The target product model is recorded in
> [`../workspace-refactor-target.md`](../workspace-refactor-target.md). In that
> model, Workspace is the only regular work record; Task terminology below is
> legacy until this glossary is fully updated.

Use these terms consistently in user-facing copy, UX specifications, and product
discussions. For workflow behavior beyond the UX vocabulary, see
[`../application-workflows.md`](../application-workflows.md).

## Work and context

- **Workspace:** The sole regular work record and a complete unit of work. It
  may use zero or more repositories and has its own lifecycle. Existing source
  checkouts stay where they are; Workspace worktrees are separate resources.
- **Legacy Task record:** A retained pre-refactor database record, not a target
  product concept or a creation option. Existing rows remain visible until the
  final archive/conversion stage.
- **Quick Request:** A named one-off tracked item under the special Quick
  Requests workspace. It is important work with its own status and lifecycle,
  not a generic label for a user's text or an OpenCode interaction.
- **Prompt:** Text supplied to OpenCode. Call the initial user text the
  **original prompt** and text prepared for a new session the **starting
  prompt**. A prompt is not itself a product record; Quick Requests retain their
  original prompt as a field on the tracked request.
- **Repository context:** Catalog repositories proposed for a new Workspace and
  the repositories associated after confirmation. Show relevant repository
  context before work begins; it determines Workspace worktrees and sessions.

## OpenCode interaction

- **OpenCode session:** One OpenCode conversation, with history owned by
  OpenCode. Except for the internal proposal step in New work, a session runs
  attached to an interactive terminal.
- **Interactive terminal:** The user's live interface to an OpenCode session or
  interactive tool process. Users watch progress and handle follow-ups,
  approvals, input, and changes there. The terminal is not an app-rendered
  transcript or a background-only process.
- **Terminal tab:** The application entry for an attached interactive terminal.
  Tabs belong to a Workspace, a temporary legacy Task record, or a Quick Request. Switching to another
  destination keeps the tab and process open; closing the tab stops its process.

## Other workbench destinations

- **Change Review:** The single name for the repository-diff destination. Use it
  in toolbar labels and prose. Change Review is separate from OpenCode's
  interactive terminal.
- **Docs reader:** The destination for reading discovered Markdown and text
  files by paths relative to their Workspace or repository source. It is not a
  general file browser or editor.
- **Tools menu:** The menu of repository-scoped tools available for the selected
  Workspace context. Legacy Task tools are transitional only.

## Avoid as product vocabulary

- **Request** by itself: ambiguous. Use **Quick Request** for the tracked item
  and **prompt** for text.
- **View** by itself: too generic to identify a destination. Name the thing:
  **interactive terminal**, **Change Review**, or **Docs reader**.
