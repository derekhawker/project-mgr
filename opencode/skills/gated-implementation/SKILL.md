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
2. Follow local record ownership; keep one authoritative home per fact. If no
   convention exists, use a user-designated record or ask where to create one.
   See [work-record](references/work-record.md) when no format is supplied. This
   skill requires no ticket system, index, or prescribed statuses.
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
5. Define the outcome, scope, non-goals, acceptance/validation, dependencies, and
   a concise **outcome checklist** (meaningful results and proof, not an ordered
   implementation breakdown). Include a manual inspection path when needed. Map
   each in-scope request to its outcome and proof. Keep proposed checklist changes
   in the approval request; do not alter a live checklist before approval. Follow
   local record ownership without duplication.
6. Show the full request coverage with proposed dispositions; ask the human to
   confirm them and explicitly approve either the bounded experiment or complete
   implementation plan. Record what was approved and when. On approved start or
   resume, reconcile an existing checklist with the approved scope, preserving
   work and evidence; initialize it only if absent. The checklist does not expand
   scope. Experiment approval authorizes only that experiment, not production work.

Completion criterion: the human has approved a bounded experiment or complete
implementation plan, every request-coverage item has an agreed disposition, each
in-scope item maps to proof, and material decisions needed for the approved work
are resolved or explicitly part of an approved experiment. Unresolved future work
stays visible and outside the approved boundary.

## Execute Within The Boundary

**Checkpoint loop:** reconcile actual state with the approved scope and checklist;
update the checklist; continue with the next ready in-scope work. Don’t hand off
while approved work remains ready. Stop only at proved completion, a blocker or
decision that prevents progress, or the approval boundary.

On “continue” or resume, re-read the record and apply this loop to the same plan.

Before declaring execution complete, reconcile the implementation against every
in-scope request-coverage item, the approved record, linked roadmap/source-of-truth
documents, acceptance checks, and known gaps. Verify each item has its promised
proof; an item without proof is incomplete, not implicitly done. Classify
discoveries as in-scope, separate follow-up, or approval-needed; continue ready
work and seek approval before crossing the approved boundary. If human-only
acceptance is the remaining gate, complete all approved implementation and
automated validation first, then hand off that exact acceptance step.

Delegate only when policy and tools permit, and only genuinely independent work.
Set clear ownership and proof; retain one integration owner and validate the
integrated result.

Implement the causal path that proves the outcome. Use the smallest useful
validation; when practical, make a test fail before implementation for the expected
missing behavior. If automated proof doesn’t fit, explain and use an appropriate
check. Keep connected work integrated when splitting it would create incomplete
seams or defer essential integration. Record evidence and limitations; add
in-scope discoveries to the checklist and defer adjacent work. If evidence changes
the outcome, proof, consequential contract, or scope, pause affected work, record
the options, and seek approval while continuing other ready approved work.

Run the project's required validation baseline when the implementation reaches its
final acceptance checks;
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
