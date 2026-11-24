# Docs Reader

## Purpose

Provide a focused way to read the selected ticket and Markdown or text files
from its verified repository. This is not a general file browser or notes editor.

## Layout and behavior

- Use the shared whole-CSS-pixel [spacing weights](../../app/packages/ui-lib/spacing.md)
  for the path list, reading surface, code blocks, and table-cell insets.
- Use the neutral gray workspace screen and a readable raised reading surface. Reserve
  C64-inspired color for the selected path and focus accent. Keep typography
  consistent with the rest of the app; verify on Wayland.
- In a ticket workbench, always show a **Docs** toolbar tab. The selected ticket
  is the first, special read-only item in the navigator, marked with a ticket SVG
  icon. It reads the canonical ticket Markdown from Workspace-owned storage
  outside the repository; it is not discovered or treated as a repository file.
  Render its content with the same application component as the Workspace ticket
  reader. Separate the Ticket item from repository files with a visible divider.
- Find files ending in `.md` or `.txt` (case-insensitive) in the selected ticket's
  verified repository worktree, or its verified Workspace checkout when no
  worktree is recorded.
  Honor `.gitignore` rules at each search root and in nested directories. Do not
  apply parent-repository, global Git excludes, or other ignore files. Also do
  not traverse dot-prefixed directories or common dependency stores:
  `node_modules`, `vendor`, `bower_components`, `third_party`, `Pods`,
  `Carthage`, `venv`, `virtualenv`, and `site-packages`.
- Show the discovered files as a persistent tree beside the selected file's
  contents. Folders start expanded and can be collapsed or reopened; show a
  folder icon beside each folder name.
- Display repository paths relative to the repository root, without a redundant
  repository-name heading. Show each path through its folder hierarchy without
  requiring hover; a collapsed folder hides its descendants until reopened.
- Automatically select the special ticket item when the reader opens.
- The file navigator has a draggable, keyboard-adjustable divider. Its width is
  shared with Change Review and restored when the app restarts.
- Render `.md` files as sanitized Markdown; render `.txt` files as plain text.
  Wrap long text and code lines. Render Markdown tables with five or more
  columns at equal column widths to keep short columns readable.
- Selecting another path changes the displayed contents without hiding the list.
  Show its source-relative path above the contents so it remains identifiable
  when the file tree is scrolled.
- Center a brief status message in the work area while files load or if loading
  fails. The special ticket item keeps Docs available when the repository has no
  matching documents.
- The Docs reader occupies the main work area beneath the persistent Workspace
  masthead and view toolbar. Switching back to a terminal restores that terminal
  in the remaining work area; the terminal tab remains open.

```text
┌ Workspace │ Task A │ Task B ──────────────────────────────────┐
│ Session │ Change Review │ Docs │ Tools                           │
├─────────────────────────────────┬──────────────────────────────┤
│ Ticket                           │ Selected document contents   │
│ ──────────────────────────────── │                              │
│ guide.md                        │                              │
│ api                             │                              │
│ README.md                       │                              │
│ web                             │                              │
│ notes.txt                       │                              │
└─────────────────────────────────┴──────────────────────────────┘
```
