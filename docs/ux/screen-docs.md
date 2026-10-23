# Docs Reader

## Purpose

Provide a focused way to read Markdown and text files found in the selected
workspace and its repositories. This is not a general file browser or notes
editor.

## Layout and behavior

- Always show a **Docs** toolbar tab for a selected Workspace or Task. Disable
  it only after discovery confirms there are no matching files.
- Find files ending in `.md` or `.txt` (case-insensitive) within the selected
  Workspace home and its verified repositories, or the Task's ready worktrees.
  Do not traverse dot-prefixed directories or common dependency stores:
  `node_modules`, `vendor`, `bower_components`, `third_party`, `Pods`,
  `Carthage`, `venv`, `virtualenv`, and `site-packages`.
- Show the discovered files as a persistent list beside the selected file's
  contents.
- Display paths relative to their source root. Workspace-home files are relative
  to the Workspace home. Repository files are relative to their repository root
  and grouped under the repository's short name. Paths must not be hidden behind
  a selection or hover.
- Automatically select the first found file when the reader opens.
- Render `.md` files as sanitized Markdown; render `.txt` files as plain text.
- Selecting another path changes the displayed contents without hiding the list.
- Center a brief status message in the work area while files load or if loading
  fails or unexpectedly returns no files. The confirmed no-files case is
  represented by the disabled **Docs** tab.
- The Docs reader occupies the main work area. Switching back to a terminal
  restores that terminal at full size; the terminal tab remains open.

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
