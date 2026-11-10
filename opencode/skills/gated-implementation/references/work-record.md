# Work Record

Use the project's task file and format when supplied. These are semantic
requirements, not a second template to impose on an existing ticket. Add detail
as the task develops; an unapproved task need not contain a finished plan.

## Before Execution

- **Request coverage:** list each distinct ask from the request and its disposition
  (in scope, follow-up, needs clarification/approval, or not applicable with why).
  Link in-scope asks to the slice and acceptance check that fulfill them.
- **Problem and value:** what needs to change and why.
- **Outcome and boundary:** observable result, scope, and non-goals.
- **Acceptance and validation:** what demonstrates success, including any manual
  inspection path and relevant commands.
- **Decisions and approval:** settled choices, assumptions, open questions, and
  the exact experiment or implementation scope the human approved.
- **Impact and dependencies:** affected architecture and living documents,
  prerequisites, and relevant source-of-truth references.
- **Slices:** ordered, outcome-oriented steps with a proof for each.

## During Execution And At Handoff

Keep a short current-state summary near the top. Preserve decision rationale and
useful evidence below it; the summary should answer where the task stands now.

- **Progress:** completed slices, current slice, remaining work, and checks still
  unverified. Distinguish artifacts changed from acceptance criteria demonstrated.
- **Evidence:** commands or scenarios, results, important failures, and
  limitations. State what manual checks observed rather than only saying “pass.”
- **Discoveries:** their effect on scope and whether work was preserved, split,
  deferred, blocked, or returned for approval.
- **Blocker:** what prevents progress, the last useful state, and what resolves it.
- **Next action:** the concrete step to take, who must act, and any prerequisite.
- **Execution context:** branch, checkout, or other location only when needed to
  find and resume the work.

Update the current summary rather than accumulating conflicting progress
statements. Keep approval history and material decision changes identifiable.

## At Completion Or Cancellation

Record the final outcome, acceptance-check results, human verification, remaining
limitations, and disposition of unfinished work. Apply project status, indexing,
delivery, and archival conventions when supplied. Otherwise keep the final state
in the same file; no index, archive directory, or Git operation is required.
