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
- Selecting a file updates the diff pane.
- Keep the session tabs available and provide **Back to terminals**; switching
  destinations never closes or stops a terminal.
- Make each repository's comparison target visible and allow a conventional
  unified/split presentation.
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
