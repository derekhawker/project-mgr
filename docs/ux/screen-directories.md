# Repositories

Open this page from the **Repositories** control in top navigation. Keep
repository rows off persistent navigation.
Use persistent navigation to leave the page; do not add a Back button.
The navigation control keeps its visible **Repositories** label and uses the
shared decorative SVG folder, not a Unicode menu symbol.

Use the shared page masthead pattern: an opaque neutral-gray band containing
only the destination type and current name separated by `/`. On this screen,
show **Settings / Repositories**. Keep descriptions and page actions in the
content area, not in the masthead. Keep the masthead on the neutral gray page
background. Give the form and directory group cards a subtly raised gray surface
with a shallow layered shadow instead of visible outlines. Separate content
areas with spacing. Center the content cards and cap them at 1000px; keep the
masthead full-width. The tree remains a Docs-style directory tree. For scan roots
sharing a filesystem-level path
component, combine them at their shortest shared parent when they contain at
most five repositories. Keep them separate above five; a lone scan root keeps
its own path. Within each displayed group, collapse child folders with at most
five repositories into their parent; retain folders with more than five. Apply
that rule independently to each branch, and do not promote empty ancestors such
as `/home` or `/tmp` above the data-bearing directory. Render actual folders
with folder icons, but repository rows without icons. Bold repo names and keep
their paths visible, wrapping when needed. Reserve
C64-inspired lavender/cyan for selected and focus states. Native picker
behavior is unchanged. Verify appearance on Wayland.

Each repository row has an enable checkbox and delete icon. The delete icon
enters multi-select mode with that repository selected; users can select more,
cancel, or confirm **Delete selected (n)**. Deletion soft-deletes catalog
entries only: repository files and existing workspace associations remain
untouched, and scans must not rediscover a soft-deleted repository at that same
canonical path. A different path is a distinct catalog entry.

Page, form, and repository-group insets and gaps use the shared whole-CSS-pixel
[spacing weights](../../app/packages/ui-lib/spacing.md).

Show operation failures in one prominent error banner beneath the page heading.
Keep errors tied to the Repository library location inline beside that form;
loading, progress, and successful completion remain neutral status messages.
Opening Repositories must still show the page if loading its contents fails, with
the failure in the page banner so the user can recover or navigate away.

## Discovered repositories

- **Add directories** opens the native multi-folder picker.
- Broad scans prune common dependency/build/output directory names (for example
  `node_modules`, `target`, `dist`, `build`, and `release`) below the selected
  root. The selected root itself remains eligible. Linked worktrees and
  submodules are not cataloged; independent separate-Git-dir checkouts may be.
- Saved-root scans run asynchronously during startup rather than delaying
  application startup or the page.
- Show the configurable **Repository library location** on this page. The user
  can type an absolute path or choose a folder; save edits after five seconds
  without changes and immediately when the field loses focus. Rust validates
  and persists each saved value.
  This is where the app keeps managed base checkouts, not a replacement for the
  existing source checkouts shown below.
- Combine scan roots sharing a filesystem-level path component at their
  shortest common parent when their combined repository count is at most five.
  Keep the roots separate above five. A single root stays at its own path, so
  empty ancestors such as `/home` and `/tmp` are not shown as directory groups.
- Within a displayed group, collapse child folders containing at most five
  repositories into the parent. Keep larger child folders as groups and apply
  the rule independently through the tree.
- Scan every saved directory at startup. Never scan the configured OpenCode
  Projects area or the configured repository-library root, including when a
  saved scan root is one of their ancestors.
- Deduplicate by verified repository identity and canonical path. If saved roots
  overlap, show each repository once under its most-specific matching root
  before applying the display grouping above.

## Repositories

- Give each discovered repository one checkbox. Checked repositories are
  enabled and available to New-work proposals; unchecking disables the repo
  without deleting its directory or catalog entry.
- Enabled/disabled decisions persist across startup scans.
- Keep each repository's full path visible so duplicate names can be distinguished.

The enabled repository list is supplied to the initial New-work proposal as
verified working-directory context. The original user prompt remains unchanged.
Adding a directory never automatically attaches every discovered repository
to a workspace.
