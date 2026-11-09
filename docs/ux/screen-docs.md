# Docs Reader

## Purpose

Provide a focused way to read Markdown and text files found in the selected
workspace and its repositories. This is not a general file browser or notes
editor.

## Layout and behavior

- Use the shared whole-CSS-pixel [spacing weights](../../app/packages/ui-lib/spacing.md)
  for the path list, reading surface, code blocks, and table-cell insets.
- Use the neutral gray workspace screen and a readable raised reading surface. Reserve
  C64-inspired color for the selected path and focus accent. Keep typography
  consistent with the rest of the app; verify on Wayland.
- Always show a **Docs** toolbar tab for a selected Workspace or Task. Disable
  it only after discovery confirms there are no matching files.
- Find files ending in `.md` or `.txt` (case-insensitive) within the selected
  Workspace home and its verified repositories, or the Task's ready worktrees.
  Honor `.gitignore` rules at each search root and in nested directories. Do not
  apply parent-repository, global Git excludes, or other ignore files. Also do
  not traverse dot-prefixed directories or common dependency stores:
  `node_modules`, `vendor`, `bower_components`, `third_party`, `Pods`,
  `Carthage`, `venv`, `virtualenv`, and `site-packages`.
- Show the discovered files as a persistent tree beside the selected file's
  contents. Folders start expanded and can be collapsed or reopened; show a
  folder icon beside each folder name.
- Display paths relative to their source root. Workspace-home files are relative
  to the Workspace home. Repository files are relative to their repository root
  and grouped under the repository's short name. Show each path through its
  folder hierarchy without requiring hover; a collapsed folder hides its
  descendants until reopened.
- Automatically select the first found file when the reader opens.
- The file navigator has a draggable, keyboard-adjustable divider. Its width is
  shared with Change Review and restored when the app restarts.
- Render `.md` files as sanitized Markdown; render `.txt` files as plain text.
  Wrap long text and code lines. Render Markdown tables with five or more
  columns at equal column widths to keep short columns readable.
- Selecting another path changes the displayed contents without hiding the list.
  Show its source-relative path above the contents so it remains identifiable
  when the file tree is scrolled.
- Center a brief status message in the work area while files load or if loading
  fails or unexpectedly returns no files. The confirmed no-files case is
  represented by the disabled **Docs** tab.
- The Docs reader occupies the main work area beneath the persistent Workspace
  masthead and view toolbar. Switching back to a terminal restores that terminal
  in the remaining work area; the terminal tab remains open.

```text
┌ Workspace │ Task A │ Task B ──────────────────────────────────┐
│ Session │ Change Review │ Docs │ Tools                           │
├─────────────────────────────────┬──────────────────────────────┤
│ Workspace                       │ Selected document contents   │
│ guide.md                        │                              │
│ api                             │                              │
│ README.md                       │                              │
│ web                             │                              │
│ notes.txt                       │                              │
└─────────────────────────────────┴──────────────────────────────┘
```
