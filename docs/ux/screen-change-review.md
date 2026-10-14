# Change Review

## Availability and comparison

- Show **Changes** only for a selected workspace or task with at least one
  associated repository.
- Compare each repository's changes against its current `origin/main` using a
  conventional two-way diff. This is not a three-way merge view.
- Include all changed files across all repositories in the selected owner's
  context.

## Layout

Use a conventional changed-file list grouped by repository beside the selected
file diff:

```text
┌ Upgrade tonic-one · Changes · 2 repos · 14 files changed ──────┐
│ Compare with: origin/main                    [Unified | Split] │
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
- Make the comparison target visible and allow a conventional unified/split
  presentation.
- Change review is an app view, not a terminal. It does not consume a terminal
  tab or take over terminal lifecycle.

## Not specified here

The exact treatment of untracked files, generated files, merge conflicts, and a
repo whose `origin/main` cannot be resolved must be specified before the review
implementation reaches those cases. Keep those cases visible; do not silently
omit them.
