# Work Record

Use the project's task file and format when supplied. These are semantic
requirements, not a second template to impose on an existing ticket. Add detail
as the task develops; an unapproved task need not contain a finished plan.

## Before Execution

- **Request coverage:** list each distinct ask from the request and its disposition
  (in scope, follow-up, needs clarification/approval, or not applicable with why).
  Link in-scope asks to the meaningful outcome and acceptance evidence that fulfill
  them.
- **Problem and value:** what needs to change and why.
- **Outcome and boundary:** observable result, scope, and non-goals.
- **Acceptance and validation:** observable criteria and relevant checks.
- **Decisions and approval:** settled choices, assumptions, open questions, and
  the exact experiment or implementation scope the human approved.
- **Impact and dependencies:** affected architecture and living documents,
  prerequisites, and relevant source-of-truth references.
- **TODO:** a short queue of approved work, ordered by readiness. Group connected
  steps into useful user journeys; replace finished actions with the next ones.
  Keep evidence in tests/artifacts. `Explore later` may hold three brief topics.
  See [Checkpoint And Recover](../SKILL.md#checkpoint-and-recover).

## During Execution And At Handoff

Keep the ticket authoritative for outcomes and decisions. Keep the TODO actionable;
put evidence in tests/artifacts and record only a short reference when it changes
readiness or acceptance.
- **Execution context:** branch, checkout, or other location only when needed to
  find and resume the work.

Follow [Checkpoint And Recover](../SKILL.md#checkpoint-and-recover). Reconcile at
a checkpoint, but write only when the TODO's actionable state changes. Do not
append turn summaries.

## At Completion Or Cancellation

Record the outcome, acceptance-check results, unavailable checks and their impact,
limitations, and disposition of unfinished work. Apply project status, indexing,
delivery, and archival conventions when supplied. Otherwise keep the final state
in the same file; no index, archive directory, or Git operation is required.
