# UX Index

This folder records the agreed user experience for the project manager. These
are screen and interaction decisions, not implementation instructions.

## Screen hierarchy

```text
Application shell
├── Left navigation
│   ├── See all Quick Requests
│   ├── Recent Quick Requests (last 24 hours)
│   ├── Workspaces
│   │   └── Tasks (optional; nested under their workspace)
│   └── New (one shared entry point)
└── Main work area for the selected owner
    ├── Workspace or task toolbar (wraps; keep items visible)
    ├── Owner-scoped interactive terminal tabs
    ├── Changes view (only when repositories are associated)
    ├── README view (when README.md files are found)
    └── Tools menu (repo tools grouped side by side; at most two repos)

Separate navigation destination: full Quick Requests list
```

## Screens

| Screen | Purpose | Specification |
|---|---|---|
| New work | Capture intent, review a structured LLM proposal, then create a workspace or task and open its session. | [screen-new-work.md](screen-new-work.md) |
| Workspace/task workbench | Switch between a workspace and its tasks; work in owner-scoped interactive terminals. | [screen-workbench.md](screen-workbench.md) |
| Quick Requests | Keep recent requests in navigation and browse the full set in a separate sliding view. | [screen-quick-requests.md](screen-quick-requests.md) |
| Change review | Review all repository changes in a conventional file-list and diff view against `origin/main`. | [screen-change-review.md](screen-change-review.md) |
| READMEs | Browse found README files by full path beside the selected file. | [screen-readmes.md](screen-readmes.md) |
| No selection | A rare, simple prompt to select work or start something new. | [screen-no-selection.md](screen-no-selection.md) |

## Overarching goals

- **Workspace is the project grouping.** It is useful with or without tasks and
  may contain zero, one, or several repositories.
- **Task is an optional, independently progressing unit of work.** A task may
  involve multiple repositories and worktrees. Work often happens in tasks, but
  tasks do not define whether a workspace is active or complete.
- **Capture intent before creating records.** The first LLM request returns a
  structured proposal. The user reviews its interpretation and expected effects
  before creation. Do not leave an empty workspace or task if initialization
  fails.
- **The terminal gets the available work area.** Do not permanently split it
  with lists, notes, or tool panes. Switching to another view does not itself
  close a terminal tab.
- **Terminal behavior belongs to the terminal.** Interactive terminals own
  process controls and lifecycle. Closing a terminal stops its process and
  closes its tab.
- **Keep navigation visible.** Quick Requests come first in the left navigation;
  workspaces and their directly nested tasks follow. Toolbar rows wrap rather
  than hiding tabs behind overflow.
- **Do not invent detail.** Preserve the original request alongside any proposed
  rewritten prompt and show inferred repositories, Jira effects, and destination
  for user review.

## Not in scope for these screens

- Regular work history is deferred. Keep a History menu option disabled.
- Repository management is not a standalone screen; repository matching belongs
  in the prompt proposal.
- No app-owned terminal emulator controls for stopping/resuming a process beyond
  what the interactive terminal provides.
