---
name: gated-implementation
description: "Use when the user selects a substantial task for collaborative scoping and gated implementation, or asks to resume, validate, or hand off work tracked in a durable file. Follow project instructions for task tracking."
---

# Gated Implementation

Carry one selected task from a confirmed problem through approved work and
validation. Keep a durable work record so progress and decisions survive a
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
5. Define outcomes, scope, non-goals, acceptance checks, and dependencies. Map
   each in-scope request to its outcome and proof. Do not duplicate checklists.
   Keep proposed scope changes in the approval request; do not alter approved
   outcomes before approval. Follow local record ownership.
6. Show the full request coverage with proposed dispositions; ask the human to
   confirm them and explicitly approve either the bounded experiment or complete
   implementation plan. Record what was approved and when. On approved start or
   resume, reconcile the existing execution plan with the approved scope,
   preserving work and evidence; initialize it only if absent. The plan does not
   expand scope. Experiment approval authorizes only that experiment, not
   production work.

## Execute Within The Boundary

Work in coherent user journeys: connect the steps needed to deliver and exercise
one useful outcome, even when they cross components. Avoid isolated pieces that
leave the journey disconnected and batches that combine unrelated outcomes.

At each checkpoint, reconcile the whole TODO against approved outcomes, checkout,
dependencies, and current state. Continue with the next ready approved journey.
The TODO is a short queue of open actions, not a progress or evidence log: remove
finished items and replace them with the next action as work advances. Add tasks
only when they change what should happen next. Keep acceptance criteria in the
ticket and proof in tests or artifacts; add only a concise reference when it
changes readiness. Stop at verified completion, a blocker, a consequential
decision, or the approval boundary.

On “continue” or resume, re-read the record and apply this loop to the same plan;
do not rely on an informal todo list from the conversation.

Before declaring execution complete, reconcile the implementation against every
in-scope outcome and acceptance check. Use available tools to exercise the
integrated result; report checks run, observed results, and checks the environment
could not perform. A claim or TODO edit is not proof. Classify discoveries as
in-scope, follow-up, or approval-needed; continue ready work and seek approval
before changing the approved boundary.

Delegate only when policy and tools permit, and only genuinely independent work.
Set clear ownership and proof; retain one integration owner and validate the
integrated result.

Use the smallest useful checks while building, then run the agreed project
validation for final acceptance. Exercise the integrated path where the environment
allows. Record unavailable checks and their impact; do not treat a tool limitation
as a pass. If evidence changes an outcome, contract, or scope, seek approval while
continuing other ready work.

Completion criterion: every in-scope outcome has acceptance evidence and required
checks pass. An unavailable required check leaves the task incomplete; record its
impact and next action. Record other unavailable checks as limitations.

## Checkpoint And Recover

Update the record after approval, a material plan change, a failed check that
changes readiness, a blocker, or before handoff/stopping. Record net state, not
turns, tool calls, or repeated validation results.

Reconcile the entire TODO with approved outcomes, checkout, dependencies, and
evidence—not only the task just worked on. Mark verified tasks complete, add
in-scope work, reorder as dependencies change, and remove unnecessary/obsolete
tasks with a short reason when that reason affects scope or recovery. Remove done
tasks once they no longer guide open work; keep durable proof in tests/artifacts
and point to it only when needed for acceptance. An optional `Explore later`
section holds at most three brief, unapproved topics; promote a topic only after
approval. Keep the TODO to actionable state, never a running history. Persist only
when that state changes. Follow local closeout rules.

Keep open, blocked, and unverified tasks distinguishable. Record completed outcome
evidence in the authoritative ticket before removing tasks that no longer guide
open work. For a blocker, record what resolves it and the first action after
resolution. For a scope change, retain the previous approval boundary and identify
what now needs approval. Use local lifecycle states when supplied.

## Finish

Record the outcome, validation results, known limitations, and disposition of
unfinished work. Follow local delivery and closeout rules. If work stops early,
leave the record resumable with the next action and reason for stopping.
