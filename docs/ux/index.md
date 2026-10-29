# UX Index

> **Refactor in progress:** `../workspace-refactor-target.md` is the accepted
> product contract. The existing screen specifications below describe the
> current implementation and are pending replacement as the implementation
> advances. Follow `../workspace-refactor-plan.md` for delivery order.

This folder records the agreed user experience for the project manager. These
are screen and interaction decisions, not implementation instructions.

## Screen hierarchy

```text
Application shell (fixed to the window)
├── Left navigation (fixed; independent navigation)
│   ├── Quick Requests (top section)
│   │   ├── See all Quick Requests
│   │   └── Recent Quick Requests (created in the last 24 hours)
│   ├── Workspaces (sole regular work record)
│   ├── Repositories (immediately above New work)
│   └── New work (Workspace or Quick Request; primary action pinned to bottom)
└── Main work area (only this pane scrolls)
    ├── Repositories page (saved scan roots and enabled/disabled repositories)
    ├── Workspace-name heading and recessed tab strip (OpenCode, open terminals, Change Review, Docs)
    ├── Full-size interactive terminal occupying the available work area
    ├── Quick Request page (Back + terminal; no tabs or task/workspace tools)
    ├── Change Review (only when repositories are associated)
    ├── Docs reader (always shown; disabled when no documents are found)
    └── Tools menu (OS handoff above a divider, then repo tools grouped side by side)

Modal: New work; leaves the current destination intact
Separate navigation destination: full Quick Requests list (all retained items)
```

## Destinations

Use the terms defined in [UX Glossary](glossary.md). This index maps the
experience; the glossary is the vocabulary reference.

| Screen | Purpose | Specification |
|---|---|---|
| New | The navigation dropdown starts a Workspace or Quick Request. Workspace creation reviews an editable proposal and optional starting prompt; Quick Request resolves a directory and starts with the original prompt. | [screen-new-work.md](screen-new-work.md) |
| Workspace workbench | Work in Workspace-owned interactive sessions; multi-repository workspaces have an orchestrator and repo workers. | [screen-workbench.md](screen-workbench.md) |
| Quick Requests | Keep the last 24 hours in navigation and browse all retained requests in a separate destination; open each in a dedicated terminal page. | [screen-quick-requests.md](screen-quick-requests.md) |
| Repositories | Manage saved scan roots and individually enabled repositories; deduplicate overlaps and scan saved roots at startup. | [screen-directories.md](screen-directories.md) |
| Change Review | Review committed and working-tree changes in a conventional file list against remote or local `main`/`master` refs. | [screen-change-review.md](screen-change-review.md) |
| Docs | Browse found Markdown and text files by source-relative path beside the selected file. | [screen-docs.md](screen-docs.md) |
| No selection | A rare, simple prompt to select work or start something new. | [screen-no-selection.md](screen-no-selection.md) |

## Overarching goals

- **Visual language:** Keep the workbench neutral gray. Use C64-inspired blue,
  lavender, and cyan as deliberate splashes on selected list items, menus, and
  popups; use muted terracotta for primary actions. Keep outlines fine, corners
  close to square, except the rounded recessed Workspace tab strip, and button
  depth subtle. Shared buttons use solid fills, modestly rounded gray borders,
  and a layered lavender-gray shadow; default buttons are white and pressed
  controls use an inset shadow. Keep navigation items flat. Avoid gradients and
  pale edge highlights. This is a light Windows 95 cue, not pixel-art nostalgia.
  Use restrained monospace labels for navigation and controls.

- **Repository directories are explicit context.** Users add selected
  directories from the Repositories page. The app persists each scan root,
  scans saved roots at startup, deduplicates repositories discovered beneath
  overlapping roots, and exposes one enabled checkbox per repository. Only
  enabled repositories enter the initial New-work proposal context. Scan roots
  sharing a filesystem-level path component group at their shortest common
  parent when the combined repository count is at most five; larger groups and
  lone roots keep their individual scan-root paths. Child folders with at most
  five repositories collapse into their parent independently; larger folders
  remain visible as groups.
  Confirmed deletion soft-deletes catalog entries without touching repository
  files or workspace bindings, and later scans keep them hidden. Never scan the
  configured OpenCode Projects root or its contents.
- **Workspace is the sole regular work record.** It is useful with or without
  repositories. New attachments use Workspace-owned branches and worktrees;
  existing source checkouts remain untouched. Zero repositories use one
  Workspace-home session; one repository uses one worker; multiple repositories
  use an outside-repository Orchestrator plus one empty worker per repository.
  A nonblank starting prompt goes only to the matching Workspace session,
  single-repository worker, or multi-repository Orchestrator.
- **Legacy Task data is compatibility data, not a creation flow.** Migration
  snapshots are retained internally for data preservation; the app does not list
  or restore archived legacy records. They do not define Workspace behavior.
- **Capture intent before creating records.** Workspace flow reviews its
  proposal and editable starting prompt. Quick Request resolves and confirms
  only its working directory, then sends the original prompt. Do not create a
  record before confirmation.
- **The terminal gets the available work area.** Do not permanently split it
  with lists, notes, or tool panes. Switching destinations does not itself
  close a terminal tab.
- **Keep the shell quiet and anchored.** The left navigation stays fixed while
  only the selected right-hand work area scrolls. Do not spend persistent space
  on decorative branding, environment labels, app diagnostics, or a footer.
- **Use compact spacing.** Keep padding on navigation links, list rows, toolbars,
  and buttons restrained so the content, not its surrounding whitespace, sets
  the screen's density. Use the shared whole-CSS-pixel
  [spacing weights](../../app/packages/ui-lib/spacing.md) for consistent insets
  and gaps across screens.
- **Iconography:** Never use Unicode characters or text glyphs as images or
  icons. Use SVG artwork for every icon, kept inline in the shared `Icon`
  component; use CSS only for state changes such as rotation or visibility.
  Icons accompanying visible labels use the shared muted treatment; icon-only
  controls retain their full-strength icons.
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
   closes its tab. Workspace terminals share a compact tab strip with Docs and
   Change Review. Each closeable session has its own ×; Docs and Change Review
   are not closeable. Restart acts on the selected terminal beside the strip.
  Quick Requests fill the available work area without tabs or that bar. If a TUI
  exits, offer restart in the same tab using the exact same OpenCode session.
  Do not show fullscreen controls.
- **Keep navigation visible.** Quick Requests come first in the left navigation;
  Workspaces follow. Legacy Task rows remain stored but are not shown as
  navigation destinations. Navigation stays visible on
  Quick Request terminal pages. Workspace toolbar rows wrap rather than hiding
  tabs behind overflow.
- **Quick Request is a named product concept; “request” is not a separate work
  type.** Use **prompt** for text supplied to OpenCode and **Quick Request** for
  the one-off tracked item. Preserve the user's original prompt alongside any
  proposed starting prompt and destination for review. Only Workspace has an
  editable starting prompt; clearing it skips prompt submission but never skips
  session startup. New work has no Task creation path.
## Not in scope for these screens

- Regular work history is deferred. Keep a History menu option disabled.
- Repository management lives on the **Repositories** page, opened from top
  navigation. Do not show the repository list in persistent navigation.
- No app-owned terminal emulator controls for stopping/resuming a process beyond
  what the interactive terminal provides.
