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
2. Use the selected task's existing file as the work record. Keep one source of
   truth rather than a ticket plus a competing execution plan. If the project
   has no convention, use a user-designated file or ask where to create it before
   implementation. Use [work-record](references/work-record.md) for the required
   information when the project has no format. A task file is sufficient: this
   skill does not require a ticket system, active index, or prescribed statuses.
3. Before selecting or implementing work, inventory every distinct outcome,
   change, question, and constraint the human raised in the current request. Add
   each to the work record's **request coverage** list, preserving the human's
   intent rather than merging unrelated asks. For each item, record its disposition:
   in scope, follow-up, needs clarification/approval, or not applicable (with why).
   Keep follow-ups visible; never silently drop an ask because another seems more
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
   architecture and documentation impact, validation, and ordered slices. Include
   an inspection or interaction path when manual verification needs one. Link each
   in-scope request-coverage item to the slice and acceptance check that fulfills
   it; retain out-of-scope items in the coverage list with their disposition.
6. Show the human the complete request-coverage list and ask for explicit approval
   of the bounded experiment or the complete implementation plan, including its
   outcome, boundaries, and ordered slices.
   Record what was approved and the conversation reference or date. Approval of
   the implementation plan authorizes every listed slice through completion;
   approval for an experiment authorizes that experiment, not production work.

Completion criterion: the human has approved a bounded experiment or complete
implementation plan, every request-coverage item has an agreed disposition, each
in-scope item maps to proof, and material decisions needed for the approved work
are resolved or explicitly part of an approved experiment. Unresolved future work
stays visible and outside the approved boundary.

## Execute Within The Boundary

Act as the implementation orchestrator: drive the approved plan from its first
ready slice through its final acceptance checks. Do not ask the human which
approved slice to do next. Follow the recorded order; if multiple slices are
equally ready and their order does not affect the outcome, choose one and
continue. Ask only when a genuine dependency, blocker, or consequential decision
prevents progress, or when the next work falls outside the approved plan.

When the human says “continue,” “resume,” “keep going,” or explicitly says not to
stop until the approved task is complete, treat that as a continuation command
for this same plan. Re-read its current state, reconcile it with the checkout,
and execute its recorded next ready action. Do not respond with a progress-only
handoff while approved slices remain.

Treat checkpoints as durable progress updates, not conversation handoffs. After
recording a completed slice, start the next ready approved slice in the same
session. Do not end a response by merely promising the next action. Before
declaring execution complete, reconcile the implementation against every
in-scope request-coverage item, the approved record, linked roadmap/source-of-truth
documents, acceptance checks, and known gaps. Verify each item has its promised
proof; an item without proof is incomplete, not implicitly done. Record discoveries
in the authoritative work record and classify them as
in-scope, separate follow-up, or approval-needed; continue ready in-scope work,
and seek approval before crossing the approved boundary. If human-only acceptance
is the remaining gate, complete all approved implementation and automated
validation first, then hand off that exact acceptance step. Human verification
is not a reason to pause between approved slices.

Delegate only when project policy and available tools permit it. Use parallel
workers for independent bounded slices with explicit file/API ownership, proof,
and handoff expectations. Retain one integration owner for shared composition;
integrate and validate delegated work before counting it as complete.

For each approved slice:

1. Identify its observable proof and relevant authoritative facts. Follow local
   workspace, testing, and delegation requirements when supplied. This skill
   requires no version-control system, worktree, branch strategy, or subagents.
2. Establish the smallest useful validation. Prefer a test that fails for the
   expected missing behavior before production changes when practical. For work
   without suitable automated tests, record why and use an appropriate check,
   such as reviewing a document against its acceptance criteria.
3. Implement the simplest causal path that proves the approved outcome. Keep
   broader abstractions and adjacent improvements outside the slice unless they
   are necessary to its approved proof.
4. Run focused checks, review the changes against acceptance checks, and record
   the evidence and limitations. Update the checklist and next action.
5. Classify discoveries: preserve the approved scope, split out independent work,
   defer adjacent work, or block on a dependency or decision. If evidence changes
   the approved outcome, proof, consequential contract, or scope boundary, pause
   affected implementation, record the options, and return to human approval.

Proceed autonomously within approved scope. Run the project's required
validation baseline after the final slice when one exists; otherwise use the
validation agreed during scoping. Record unavailable checks and their impact
rather than inventing commands or treating missing tooling as a pass.

Completion criterion: every in-scope request-coverage item and every slice in the
approved plan has its acceptance proof, every discovered in-scope gap is accounted
for and implemented, required execution checks pass, and remaining final human
checks are identified. Every other ask has an explicit follow-up, clarification,
or other agreed disposition. Continue to the next ready
slice after recording each checkpoint. Failed or unavailable required checks
leave execution incomplete, with the gap and next action recorded.

## Checkpoint And Recover

Update the record after approval, a completed slice, an important discovery, a
failed check, a blocker, and before a handoff or stopping. Record meaningful
changes rather than a transcript of tool calls.

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
