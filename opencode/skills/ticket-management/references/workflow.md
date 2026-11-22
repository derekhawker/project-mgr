# Workspace Ticket Workflow

## Authority and location

Use the canonical Workspace ticket directory provided in session instructions.
Tickets are `<slug>.md` outside the repository; closed tickets move to
`archived/<slug>.md`. The main ticket is authoritative for identity, status,
approved scope, decisions, and recorded work-session ID. During approved active
work, keep a linked `<slug>.todo` beside it as the single actionable execution
plan. The companion contains Markdown but has no `.md` extension. It is execution
state, not a second ticket or status record. The ticket holds approved outcomes,
acceptance criteria, scope, and decisions; the TODO decomposes approved outcomes
into ordered tasks. Keep the TODO small: one `# TODO` task list and an optional
`## Explore later` with at most three brief, unapproved topics. No turn history,
repeated test logs, duplicate outcome checklist, or execution-task list in the
ticket. The plan is a starting point, not a fixed sequence; update tasks as work
completes, dependencies emerge, or items prove unnecessary. Do not create an
index.

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
Name ticket worktrees with the repository name as a prefix, followed by the
ticket slug (for example, `project-mgr-<ticket-slug>`). Keep the name within the
configured worktree directory; choose a disambiguating suffix only if that name
is already in use.

Before work, read the canonical Markdown ticket, confirm its identity and status,
and follow its approved scope. Present the proposed high-level outcomes and
acceptance criteria for user approval; do not require a TODO companion before
approval. For a `draft` ticket, preserve any existing companion but do not resume
execution or rebuild a missing file. When approved work begins or resumes, check
the canonical companion path. If it exists, preserve and reconcile it with the
approved scope, repairing a missing ticket link. If `.todo` is absent but a
legacy `.progress` companion exists, compact and rename it to `.todo`, preserving
open approved tasks and material blockers, then update the ticket link. Otherwise,
initialize one actionable TODO from the approved outcomes, actual checkout,
dependencies, and available evidence; on resumption rebuild it from those sources
and leave unproved work incomplete. Add the next action and link the companion
from the ticket before continuing. When a ticket returns to
`in_progress` after renewed approval, reconcile any preserved companion with the
newly approved scope. When a session is created or resumed, ensure its durable
`workspace-ticket` instruction entry identifies only
the ticket title/slug, filename and canonical path, current status, ticket
directory, repository root, and this global skill.
Do not duplicate ticket body in the entry. Direct OpenCode to read the canonical
file for content and latest status, and the linked TODO for actionable work.
Refresh the entry after session creation and before opening the
terminal, and refresh status when selecting/resuming. A replacement session
receives a new entry keyed to its new exact session ID and replaces the ID in the
ticket front matter. Ensure the OpenCode process can read and write the ticket
path and companion.

The Work action itself does not change status. Perform status transitions through
OpenCode and persist them in the Markdown ticket. If a recorded session is
unavailable, start a replacement session and update the ticket's session ID.

Reconcile the whole TODO with the ticket, checkout, dependencies, and evidence at
each checkpoint, but persist only when an approved task, its order/dependency, or a
blocker materially changes. Reconciliation alone is not a write. Mark completed
tasks and remove them once they no longer guide open work; retain only concise
proof needed for readiness or acceptance. Add discovered in-scope work, reorder as
dependencies change, and record why tasks are unnecessary or out of scope. Put
material scope and decision changes in the ticket first. The TODO never overrides
ticket status, outcomes, acceptance, scope, decisions, or session binding. Keep it
while the ticket remains active or delivery/cleanup is blocked.

## Closeout

Before beginning the closeout sequence, obtain the user's explicit confirmation
to proceed. This confirmation is a prerequisite to the entire sequence, not a
per-action approval gate.

For completion, finish required checks, delivery, and cleanup before closing the
ticket. Follow project-specific delivery instructions; where none override them,
apply shared ticket-workflow defaults. Do not assume a shared merge strategy when
project policy specifies one. If delivery or cleanup is unsafe or blocked,
preserve the worktree, companion, and ticket; leave the ticket open or blocked
with the reason and next step recorded. Remote branch deletion is not implied.
After completion prerequisites pass, transfer relevant final progress, evidence,
and remaining-work disposition into the ticket; record verification and persist
`done`.

For cancellation, record why work stopped, relevant progress and evidence, and the
disposition of completed and remaining work in the ticket; then persist
`cancelled`. After either terminal status is recorded, remove the companion link,
delete the companion, and archive the ticket under `archived/<slug>.md`. Never
archive an active ticket. Before moving a terminal ticket into `archived/`, add
`archived_at` to its YAML front matter as a quoted ISO 8601 date-time string.
