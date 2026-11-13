# Workspace Ticket Workflow

## Authority and location

Use the canonical Workspace ticket directory provided in session instructions.
Tickets are `<slug>.md` outside the repository; closed tickets move to
`archived/<slug>.md`. The Markdown file is the sole authority for status and
recorded work-session ID. Read it before acting and write changes back there.
Do not create an index or second ticket/status record.

## Status lifecycle

- `draft`: captured or being clarified/groomed; not approved for execution.
- `in_progress`: approved work is underway.
- `blocked`: a recorded external blocker prevents progress; preserve the last
  useful state and next step.
- `done`: approved work and required verification are complete; terminal before
  archival.
- `cancelled`: work is abandoned; record the reason and disposition of completed
  and remaining work; terminal before archival.

Keep status in Markdown. Move `draft` to `in_progress` only when approved work
begins. Use `blocked` when progress cannot proceed, then return to
`in_progress` when resolved. If evidence requires renewed grooming or approval,
return to `draft`. Move to `done` only after approved work and verification;
move to `cancelled` only with its disposition recorded. Archive closed tickets
under `archived/<slug>.md` after closeout. The application displays status and
does not change it.

## Work and recovery

Each ticket has one OpenCode work session. The ticket's YAML front matter records
its exact session ID. For selected ticket work, use the shared ticket-workflow
defaults for the checkout arrangement: a dedicated worktree and branch unless
project instructions specify another arrangement. A replacement session should
resume from the ticket's recorded checkout and branch when the project tracks
them.

Before work, read the canonical Markdown ticket, confirm its identity and status,
and follow its approved scope. When a session is created or resumed, ensure its
durable `workspace-ticket` instruction entry identifies only the ticket title/
slug, filename and canonical path, current status, ticket directory, repository
root, and this global skill. Do not duplicate ticket body in the entry. Direct
OpenCode to read the canonical file for content and latest status. Refresh the
entry after session creation and before opening the terminal, and refresh status
when selecting/resuming. A replacement session receives a new entry keyed to its
new exact session ID and replaces the ID in the ticket front matter. Ensure the
OpenCode process can read and write the ticket path.

The Work action itself does not change status. Perform status transitions through
OpenCode and persist them in the Markdown ticket. If a recorded session is
unavailable, start a replacement session and update the ticket's session ID.

## Closeout

Before beginning the closeout sequence, obtain the user's explicit confirmation
to proceed. This confirmation is a prerequisite to the entire sequence, not a
per-action approval gate.

For completion, record verification and set `done` only when approved work and
required checks are complete. For selected ticket work, follow the shared
ticket-workflow defaults for publishing, squash-merging, and safely removing the
clean ticket worktree and local branch before marking the ticket done. For
cancellation, record why work stopped and what was completed or remains, then
set `cancelled`. Archive either terminal ticket under `archived/<slug>.md`. Never
archive an active ticket. Before moving a terminal ticket into `archived/`, add
`archived_at` to its YAML front matter as a quoted ISO 8601 date-time string.
