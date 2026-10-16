# Directories

Open this page from the hamburger-style **Directories** control at the top of
navigation. Keep repository rows off persistent navigation.

## Discovered repositories

- **Add directories** opens the native multi-folder picker.
- Show every saved directory and group discovered repositories beneath it.
- Scan every saved directory at startup. Never scan the configured OpenCode
  Projects area.
- Deduplicate by verified repository identity and canonical path. If saved roots
  overlap, show each repository once under its most-specific matching root.

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
