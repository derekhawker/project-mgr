# UX Index

This folder records the agreed user experience for the project manager. These
are screen and interaction decisions, not implementation instructions.

## Screen hierarchy

```text
Application shell (fixed to the window)
├── Left navigation (fixed; independent navigation)
│   ├── Quick Requests (top section)
│   │   ├── See all Quick Requests
│   │   └── Recent Quick Requests (last 24 hours)
│   ├── Workspaces
│   │   └── Tasks (optional; nested under their workspace)
│   └── New (proposal flow)
└── Main work area (only this pane scrolls)
    ├── Compact workspace/task bar
    ├── Full-size interactive terminal (with fullscreen control)
    ├── Change Review (only when repositories are associated)
    ├── README reader (when README.md files are found)
    └── Tools menu (repo tools grouped side by side; at most two repos)

Modal: New work; leaves the current destination intact
Separate navigation destination: full Quick Requests list
```

## Destinations

Use the terms defined in [UX Glossary](glossary.md). This index maps the
experience; the glossary is the vocabulary reference.

| Screen | Purpose | Specification |
|---|---|---|
| New | Capture a prompt, review its workspace interpretation, create a workspace, then start its tracked OpenCode session. The same flow will later support Quick Requests. | [screen-new-work.md](screen-new-work.md) |
| Workspace/task workbench | Switch between a workspace and its tasks; work in owner-scoped interactive terminals. | [screen-workbench.md](screen-workbench.md) |
| Quick Requests | Keep recent Quick Requests in navigation and browse the full set in a separate sliding destination. | [screen-quick-requests.md](screen-quick-requests.md) |
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
- **Capture intent before creating records.** New work first interprets the
  original prompt. The user reviews the proposed workspace and starting prompt
  before creation. Do not create a workspace until the proposal is confirmed.
- **The terminal gets the available work area.** Do not permanently split it
  with lists, notes, or tool panes. Switching destinations does not itself
  close a terminal tab.
- **Keep the shell quiet and anchored.** The left navigation stays fixed while
  only the selected right-hand work area scrolls. Do not spend persistent space
  on decorative branding, environment labels, app diagnostics, or a footer.
- **Creation must not displace current work.** New opens as a modal over the
  current destination and preserves the existing screen and terminal. The
  resulting workspace is selected only after confirmation.
- **OpenCode work happens in an interactive terminal.** Except for the internal
  proposal step in New, every OpenCode session is attached to its interactive
  terminal. Navigating to a workspace opens or restores the workspace's tracked
  session in that terminal.
- **Terminal behavior belongs to the terminal.** Interactive terminals own
  process controls and lifecycle. Closing a terminal stops its process and
  closes its tab. Keep a compact task/session bar above the terminal and provide
  a fullscreen mode for the terminal itself.
- **Keep navigation visible.** Quick Requests come first in the left navigation;
  workspaces and their directly nested tasks follow. Toolbar rows wrap rather
  than hiding tabs behind overflow.
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
