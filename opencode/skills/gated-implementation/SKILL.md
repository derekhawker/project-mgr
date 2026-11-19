---
name: gated-implementation
description: "Use when the user selects a substantial task for collaborative scoping and gated implementation, or asks to resume, validate, or hand off work tracked in a durable file. Follow project instructions for task tracking."
---

# Gated Implementation

Carry one selected task from a confirmed problem through approved work to human
verification. Keep a durable work record so progress and decisions survive a
conversation or session boundary. For an already-approved, in-progress plan,
maintain its progress and reconcile newly discovered work against its scope;
implementing unapproved follow-up remains outside the approved boundary.

## Establish Or Resume The Record

1. Read applicable project instructions, including `AGENTS.md` when present, and
   follow their pointers for task selection, tracking format, lifecycle,
   validation, and delivery. Resolve project paths from the project or instruction
   file, not this skill's installation directory. Local instructions supply
   project policy; this skill supplies the implementation process.
2. Follow the project's record convention. Keep each fact authoritative in one
   place; when local policy assigns scope/status/decisions to a ticket and live
   execution tracking to a companion, use that split rather than duplicating a
   second plan. If the project has no convention, use a user-designated file or
   ask where to create it before implementation. Use
   [work-record](references/work-record.md) when no format is supplied. This
   skill does not require a ticket system, active index, or prescribed statuses.
3. Before selecting or implementing work, inventory every distinct outcome,
   change, question, and constraint the human raised in the current request.
   Preserve them in the request-coverage list of the record designated by local
   policy. If policy does not permit writing before approval, keep the coverage in
   the approval request until then. Preserve the human's intent rather than
   merging unrelated asks. For each item, record its disposition: in scope,
   follow-up, needs clarification/approval, or not applicable (with why). Keep
   follow-ups visible; never silently drop an ask because another seems more
   central. If the request contains multiple independent outcomes, present the
   proposed coverage and ask which belong in the current approved task before
   implementation. A request may be one task or several; do not force it into one.
4. On resumption, read the record, required source-of-truth documents, and relevant
   working files or artifacts. Inspect branch and checkout state when version
   control is in use. Reconcile recorded progress with the actual changes and
   validation evidence. Reconcile every request-coverage item with its current
   disposition. Check that approval covers the next action; resuming a task does
   not expand its approved scope.

Completion criterion: every distinct ask has a recorded disposition, the selected
task has an identified record, its current state is understood, and the next
action is either approved work or a named question for the human.

## Shape And Approve

1. Confirm the problem and intended value with the human before substantial
   research or implementation planning. Existing task wording is a hypothesis,
   not automatically an approved design. Reuse previously recorded confirmation
   when it still applies.
2. Investigate the relevant behavior and constraints. Describe the smallest
   observable outcome, the causal path that produces it, and the evidence that
   would demonstrate its value. Separate the outcome from supporting machinery.
   Current architecture is evidence about constraints, not the limit of available
   designs; consider a new seam or system when it better serves the outcome.
3. Resolve decisions collaboratively, one decision frontier at a time. Give a
   recommendation, alternatives, and important tradeoffs; wait for the answer
   before treating an unsettled consequential choice as a requirement.
4. Separate empirical uncertainty from questions of intent. Propose a bounded
   experiment when evidence can answer a question. Record its hypothesis,
   constraints, provisional setup, and success or failure signals. Review each
   hypothesis with the human: record what the observations support, refute, or
   leave unknown. Promote only supported conclusions into production decisions;
   keep the rest provisional or propose another experiment.
5. Record the selected outcome, scope, non-goals, acceptance checks, dependencies,
   architecture and documentation impact, validation, and a concise checklist of
   meaningful outcomes. Include an inspection or interaction path when manual
   verification needs one. Link each in-scope request-coverage item to the
   checklist outcome and acceptance evidence that fulfills it; retain out-of-scope
   items in the coverage list with their disposition. Keep the proposed checklist
   in the approval request until the human approves it; do not replace an existing
   live checklist during grooming. After approval, use the execution record
   designated by local policy and follow any authority split without duplicating
   the checklist. Do not prescribe an implementation breakdown when the work is
   more coherent as an integrated effort.
6. Show the human the complete request-coverage list and ask for explicit approval
   of the bounded experiment or the complete implementation plan, including its
   outcome, boundaries, and meaningful outcome checklist. Record what was
   approved and the conversation reference or date. When approved work begins or
   resumes, reconcile an existing checklist with the newly approved scope,
   preserving actual work and evidence; initialize it only if absent. Do not
   duplicate it in another record. The checklist tracks approved work and does not
   expand its boundary.
   Approval for an experiment authorizes that experiment, not production work.

Completion criterion: the human has approved a bounded experiment or complete
implementation plan, every request-coverage item has an agreed disposition, each
in-scope item maps to proof, and material decisions needed for the approved work
are resolved or explicitly part of an approved experiment. Unresolved future work
stays visible and outside the approved boundary.

## Execute Within The Boundary

Act as the implementation orchestrator: drive approved work through its final
acceptance checks. At each checkpoint, reconcile actual state against the approved
outcome and live checklist, update the checklist, then continue with the next
ready in-scope work. Do not hand off merely because one outcome is complete or ask
what to do next when approved work is clear. Stop only when completion is proved,
a genuine blocker or consequential decision prevents progress, or work reaches
the approved boundary. A checkpoint is a durable update, not a conversation
handoff while ready approved work remains.

When the human says “continue,” “resume,” “keep going,” or explicitly says not to
stop until the approved task is complete, treat that as a continuation command
for this same plan. Re-read its current state, reconcile it with the checkout,
and execute the next ready approved work.

Before declaring execution complete, reconcile the implementation against every
in-scope request-coverage item, the approved record, linked roadmap/source-of-truth
documents, acceptance checks, and known gaps. Verify each item has its promised
proof; an item without proof is incomplete, not implicitly done. Classify
discoveries as in-scope, separate follow-up, or approval-needed; continue ready
work and seek approval before crossing the approved boundary. If human-only
acceptance is the remaining gate, complete all approved implementation and
automated validation first, then hand off that exact acceptance step.

Delegate only when project policy and available tools permit it. Use parallel
workers only for genuinely independent work with explicit file/API ownership,
proof, and handoff expectations. Retain one integration owner for shared
composition; integrate and validate delegated work before counting it as complete.

For the work:

1. Identify its observable proof and relevant authoritative facts. Follow local
   workspace, testing, and delegation requirements when supplied. This skill
   requires no version-control system, worktree, branch strategy, or subagents.
2. Establish the smallest useful validation. Prefer a test that fails for the
   expected missing behavior before production changes when practical. For work
   without suitable automated tests, record why and use an appropriate check,
   such as reviewing a document against its acceptance criteria.
3. Implement the simplest causal path that proves the approved outcome. Keep
   broader abstractions and adjacent improvements outside scope unless they are
   necessary to its approved proof. Keep connected changes integrated when
   separating them would create incomplete seams or defer essential integration.
4. Run focused checks, review the changes against acceptance checks, and record
   the evidence and limitations. Update the checklist and next action.
5. Classify discoveries: preserve the approved scope, add meaningful in-scope
   outcomes to the checklist, defer adjacent work, or block on a dependency or
   decision. If evidence changes the approved outcome, proof, consequential
   contract, or scope boundary, pause affected implementation, record the
   options, and return to human approval.

Proceed autonomously within approved scope. Run the project's required
validation baseline when the implementation reaches its final acceptance checks;
otherwise use the validation agreed during scoping. Record unavailable checks
and their impact rather than inventing commands or treating missing tooling as a
pass.

Completion criterion: every in-scope request-coverage item and approved outcome
has its acceptance proof, every discovered in-scope gap is accounted for and
implemented, required execution checks pass, and remaining final human checks are
identified. Every other ask has an explicit follow-up, clarification, or other
agreed disposition. Failed or unavailable required checks leave execution
incomplete, with the gap and next action recorded.

## Checkpoint And Recover

Update the record after approval, meaningful progress, an important discovery, a
failed check, a blocker, and before a handoff or stopping. Record meaningful
changes rather than a transcript of tool calls.

Reconcile the live checklist with the checkout at every checkpoint. Mark
demonstrated outcomes complete with concise evidence;
add newly discovered in-scope work; revise changed entries; and remove stale,
duplicate, obsolete, or out-of-scope entries after recording material disposition
in the authoritative scope/decision record. Keep the list focused on current work
and recovery, not activity history. Follow local closeout rules for final evidence
and record cleanup.

Keep completed, in-progress, blocked, and unverified work distinguishable. For a
blocker, record the last useful state, what resolves it, and the first action
after resolution. For a scope change, retain the previous approval boundary and
identify what now needs approval. Use local lifecycle states when supplied.

Completion criterion: another session can find the current scope, progress,
decisions, evidence, blocker or uncertainty, and next action without rebuilding
the conversation.

## Verify And Hand Back

1. Review every acceptance check, every request-coverage item, and relevant living
   document. Record the final
   validation evidence, known limitations, and any incomplete work.
2. Prepare a final human verification packet: what changed, how to exercise or
   inspect it, expected observations, and what automated checks did not establish.
3. Wait for human verification. Record the result; return failures to the
   execution loop within scope, or seek approval when the fix changes scope.
4. Follow project delivery and closeout rules. Where none exist, record the
   verified outcome and completed state in the work record. Follow the applicable
   ticket workflow for required delivery and post-merge worktree cleanup;
   completion does not authorize unrelated cleanup operations.

Completion criterion: human verification is recorded, all required checks and
approved work are complete, and local delivery obligations are satisfied. If
work stops early, leave an explicit incomplete or cancelled state with completed
work, remaining work, and the reason for stopping.
