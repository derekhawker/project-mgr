# UX Glossary

> **Transition in progress:** The approved ticket-first model and remaining
> proof are recorded in [`../workspace-ticket-workflow-proposal.md`](../workspace-ticket-workflow-proposal.md).

Use these terms consistently in user-facing copy, UX specifications, and product
discussions. For workflow behavior beyond the UX vocabulary, see
[`../application-workflows.md`](../application-workflows.md).

## Work and context

- **Workspace:** A project grouping coupled to one repository. Existing source
  checkouts stay where they are unless the user chooses otherwise.
- **Ticket:** A Workspace-owned Markdown work record outside Git. Selection sets
  context; the separate **Work** action opens or resumes its OpenCode session.
- **Ticket idea proposal:** Transient OpenCode-generated title and Markdown
  content shown for review before Rust creates a new `draft` ticket. It is not a
  ticket record or an interactive session.
- **Legacy Task record:** A retained pre-refactor database record, not a target
  product concept or a creation option. Existing archived metadata remains
  internal compatibility data and is not exposed as an in-app destination.
- **Quick Request:** A named one-off tracked item under the special Quick
  Requests workspace. It is important work with its own status and lifecycle,
  not a generic label for a user's text or an OpenCode interaction.
- **Prompt:** Text supplied to OpenCode. Call the initial user text the
  **original prompt** and text prepared for a new session the **starting
  prompt**. A prompt is not itself a product record; Quick Requests retain their
  original prompt as a field on the tracked request.
- **Repository context:** The single repository associated with a Workspace and
  used as the working directory for its ticket sessions and tools.

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

## Screens and controls

- **New Work menu:** The dropdown at the bottom of the left navigation that
  offers Workspace and Quick Request. Selecting either opens the New Work modal.
- **New Work modal:** The dialog over the current destination used to capture
  and review a new Workspace or Quick Request. It is distinct from the New Work
  menu that opens it.
- **Workspace screen:** The main work area for a selected Workspace,
  including its session tabs, terminal, and toolbar.
- **Change Review:** The single name for the repository-diff destination. Use it
  in toolbar labels and prose. Change Review is separate from OpenCode's
  interactive terminal.
- **Docs reader:** The destination for reading discovered Markdown and text
  files by paths relative to their Workspace or repository source. It is not a
  general file browser or editor.
- **Tools menu:** The menu opened by **Tools** in the Workspace screen
  toolbar. It offers OS handoff actions and tools for associated repositories.

## Avoid as product vocabulary

- **Request** by itself: ambiguous. Use **Quick Request** for the tracked item
  and **prompt** for text.
- **View** by itself: too generic to identify a destination. Name the thing:
  **interactive terminal**, **Change Review**, or **Docs reader**.
