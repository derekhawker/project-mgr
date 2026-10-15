# README Reader

## Purpose

Provide a focused way to read README files found in the selected workspace and
its repositories. This is not a general file browser or notes editor.

## Layout and behavior

- Show the discovered README files as a persistent list beside the selected
  file's contents.
- Display each file's full path in the list; paths must not be hidden behind a
  selection or hover.
- Automatically select the first found README when the reader opens.
- Selecting another path changes the displayed contents without hiding the list.
- If no README is found, do not show an empty README reader entry.
- The README reader occupies the main work area. Switching back to a terminal
  restores that terminal at full size; the terminal tab remains open.

```text
┌ Workspace │ Task A │ Task B ──────────────────────────────────┐
│ Session │ Change Review │ READMEs │ Tools                       │
├─────────────────────────────────┬──────────────────────────────┤
│ /home/me/project/README.md       │ Selected README contents     │
│ /home/me/repos/api/README.md     │                              │
│ /home/me/repos/web/README.md     │                              │
└─────────────────────────────────┴──────────────────────────────┘
```
