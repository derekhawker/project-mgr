# UX Index

This folder records the agreed user experience for the project manager. These
are screen and interaction decisions, not implementation instructions.

## Screen hierarchy

```text
Application shell (fixed to the window)
├── Left navigation (fixed; independent navigation)
│   ├── Quick Requests (top section)
│   │   ├── See all Quick Requests
│   │   └── Recent Quick Requests (created in the last 24 hours)
│   ├── Workspaces
│   │   └── Tasks (optional; nested under their workspace)
│   └── New (work-type dropdown; pinned to navigation bottom)
└── Main work area (only this pane scrolls)
    ├── Compact workspace/task bar when a workspace/task is selected
    ├── Full-size interactive terminal occupying the available work area
    ├── Quick Request page (Back + terminal; no tabs or task/workspace tools)
    ├── Change Review (only when repositories are associated)
    ├── README reader (when README.md files are found)
    └── Tools menu (repo tools grouped side by side; at most two repos)

Modal: New work; leaves the current destination intact
Separate navigation destination: full Quick Requests list (all retained items)
```

## Destinations

Use the terms defined in [UX Glossary](glossary.md). This index maps the
experience; the glossary is the vocabulary reference.

| Screen | Purpose | Specification |
|---|---|---|
| New | The navigation dropdown chooses workspace, contextual task, or Quick Request flow. A Quick Request resolves its working directory, then starts its tracked terminal with the original prompt. | [screen-new-work.md](screen-new-work.md) |
| Workspace/task workbench | Switch between a workspace and its tasks; work in owner-scoped interactive terminals. | [screen-workbench.md](screen-workbench.md) |
| Quick Requests | Keep the last 24 hours in navigation and browse all retained requests in a separate destination; open each in a dedicated terminal page. | [screen-quick-requests.md](screen-quick-requests.md) |
| Change Review | Review all repository changes in a conventional file list and diff against `origin/main`. | [screen-change-review.md](screen-change-review.md) |
| READMEs | Browse found README files by full path beside the selected file. | [screen-readmes.md](screen-readmes.md) |
| No selection | A rare, simple prompt to select work or start something new. | [screen-no-selection.md](screen-no-selection.md) |

## Overarching goals

- **Workspace is the project grouping.** It is useful with or without tasks and
  knows about zero or more repositories. That repository context informs work
  proposals and where task worktrees are created; it does not silently move
  existing repositories.
- **Task is an optional, independently progressing unit of work.** A task may
  involve multiple repositories and worktrees. Work often happens in tasks, but
  tasks do not define whether a workspace is active or complete.
- **Capture intent before creating records.** Workspace and task flows review
  their proposed work and starting prompt before creation. Quick Request flow
  resolves and confirms only its working directory, then sends the original
  prompt. Do not create a record before confirmation.
- **The terminal gets the available work area.** Do not permanently split it
  with lists, notes, or tool panes. Switching destinations does not itself
  close a terminal tab.
- **Keep the shell quiet and anchored.** The left navigation stays fixed while
  only the selected right-hand work area scrolls. Do not spend persistent space
  on decorative branding, environment labels, app diagnostics, or a footer.
- **Use compact spacing.** Keep padding on navigation links, list rows, toolbars,
  and buttons restrained so the content, not its surrounding whitespace, sets
  the screen's density.
- **Creation must not displace current work.** The New dropdown opens over the
  current destination and preserves the existing screen and terminal. The
  resulting workspace or Quick Request destination is selected only after
  confirmation.
- **OpenCode work happens in an interactive terminal.** Except for the internal
  proposal step in New, every OpenCode session is attached to its interactive
  terminal. Navigating to a workspace opens or restores the workspace's tracked
  session in that terminal.
- **Terminal behavior belongs to the terminal.** Interactive terminals own
  process controls and lifecycle. Closing a terminal stops its process and
  closes its tab. Workspace/task terminals use a compact task/session bar;
  Quick Requests fill the available work area without tabs or that bar.
- **Keep navigation visible.** Quick Requests come first in the left navigation;
  workspaces and their directly nested tasks follow. Navigation stays visible on
  Quick Request terminal pages. Workspace toolbar rows wrap rather than hiding
  tabs behind overflow.
- **Quick Request is a named product concept; “request” is not a separate work
  type.** Use **prompt** for text supplied to OpenCode and **Quick Request** for
  the one-off tracked item. Preserve the user's original prompt alongside any
  proposed starting prompt and destination for review.
## Not in scope for these screens

- Regular work history is deferred. Keep a History menu option disabled.
- Repository management is not a standalone screen; repository matching belongs
  in the prompt proposal.
- No app-owned terminal emulator controls for stopping/resuming a process beyond
  what the interactive terminal provides.
