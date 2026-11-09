# Shared Ticket Workflow Defaults

These defaults apply to explicitly selected ticket work. Follow the project's
instructions and ticket format where they adapt these rules. Load
`gated-implementation` for the collaborative implementation process; this file
sets local defaults for tracking and delivery.

## Selection And Scope

- Work only on a ticket the user explicitly selected for execution. Read its
  record and the project's directly relevant source-of-truth documents.
- Treat the ticket as the durable work record. Keep decisions, scope, progress,
  evidence, blockers, and next action there instead of creating a competing plan.
- Keep the approved scope explicit. Pause for user direction when new evidence
  changes the intended outcome, acceptance proof, a consequential contract, or
  the scope boundary. Continue autonomously on in-scope implementation details.

## Worktrees And Branches

- Before implementation edits, use a dedicated worktree and branch for the
  selected ticket unless project instructions specify a different arrangement.
- Verify the worktree path, branch, intended base, and initial Git status before
  editing. Preserve pre-existing changes; do not clean or overwrite them.
- Keep the ticket record or project active-work index synchronized with the
  current worktree and branch when the project tracks that information.
- On resumption, inspect the recorded checkout and Git state before continuing.

## Execution And Delivery

- Follow the ticket's ordered slices and acceptance checks. Record focused
  validation evidence, limitations, and discoveries in the work record.
- Keep unrelated discoveries visible as follow-up work rather than expanding the
  approved task silently.
- Before closeout, reconcile every in-scope request and acceptance check against
  implementation and evidence, then provide the user with any required manual
  verification steps.
- Follow the project's merge, worktree cleanup, and ticket-closeout rules.
  Completion does not by itself authorize pushing, merging, or deleting a
  worktree.
