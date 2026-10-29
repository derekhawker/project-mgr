# Change Review

## Availability and comparison

- Show **Change Review** only for a selected workspace or task with at least one
  associated repository.
- Compare each repository against its remote default branch when that branch is
  `main` or `master`; if unavailable, use local `main` or `master`. Use a
  conventional two-way diff, not a three-way merge.
- Prefer `origin/HEAD` when it points to `origin/main` or `origin/master`; if
  that symbolic ref is missing or unusable, try `origin/main` and then
  `origin/master`. If neither remote ref exists, try local `main`, then local
  `master`. Show whether the selected ref is remote or local for each repository.
- Include committed divergence from the selected base and staged, unstaged,
  and untracked working-tree changes across all owner repositories.

## Layout

Use compact shared controls and the neutral gray workbench. Reserve C64-inspired
color for selected file rows and focus indicators. Let the selected tab name the
page; keep toolbar actions grouped without crowding, and the changed-file list
visually distinct from the diff surface.
Use the shared whole-CSS-pixel [spacing weights](../../app/packages/ui-lib/spacing.md)
for file rows, toolbar gaps, and diff-pane insets.
Verify the visual layout on Wayland.

Use a conventional changed-file list grouped by repository beside the selected
file diff:

```text
┌ Upgrade tonic-one · Change Review · 2 repos · 14 files changed ─┐
│ Compare with: origin/main or local master     [Unified | Split] │
├────────────────────────┬───────────────────────────────────────┤
│ agentic-frontend (8)   │ package.json                          │
│  package.json          │ - old dependency                      │
│  src/client.ts         │ + updated dependency                  │
│ tonic-one (6)          │                                       │
│  src/index.ts          │          Selected file diff           │
│  tests/index.test.ts   │                                       │
└────────────────────────┴───────────────────────────────────────┘
```

- Keep every repo and changed file discoverable in the list; do not require
  switching a repo filter to reveal other changes.
- Group each repository's paths in an initially expanded, collapsible folder
  tree with a folder icon beside each folder name. Show the file's Git status
  beside its name. For multiple repositories,
  label each group; for a single repository, the toolbar identifies the group.
  The toolbar shows the selected repository, file count, and comparison target;
  its repository path is available without repeating it in the list.
- Selecting a file updates the diff pane.
- The file navigator has a draggable, keyboard-adjustable divider. Its width is
  shared with Docs and restored when the app restarts.
- Name the selected file once above its diff, without a second diff-library
  file header.
- Keep the session tabs available; switching destinations never closes or stops
  a terminal. Do not add a Back button.
- Make each repository's comparison target visible and allow a conventional
  unified/split presentation. Remember the selected presentation across tab
  switches and application restarts; use unified by default.
- Use the light workbench palette for the diff, color additions and removals
  distinctly, show line numbers and align split changes. Automatically load full
  file context for the selected tracked text file. Untracked text already appears in full.
  Wrap long lines to the available width; line-number gutters scroll and resize
  with their rows, and split rows stay aligned when either side wraps.
  If the file or patch exceeds 1 MiB or the patch exceeds 20,000 lines, show the
  error and retain the compact diff rather than loading an oversized view.
- Change Review is an app destination, not a terminal. It does not consume a terminal
  tab or take over terminal lifecycle.

## File and comparison cases

- Include untracked, non-ignored text files in the changed-file list and show
  their contents as additions. Keep binary or otherwise unreadable files listed
  with a clear indication that no text diff is available.
- Include all changes reported by Git, including generated files; do not infer
  generated status or filter files by naming convention. Git-ignored files are
  not part of the review.
- Show merge-conflicted files in the list with their Git status. Keep conflict
  handling simple: do not add a separate conflict-resolution or stage-viewing
  interface.
- If no remote or local `main`/`master` ref can be resolved for one repository,
  keep that repository and working-tree changes visible, show the comparison
  error for that repository, and allow review of other repositories to continue.
