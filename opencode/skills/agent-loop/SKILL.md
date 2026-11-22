---
name: agent-loop
description: Continue an explicitly armed ticket loop from its canonical work records.
disable-model-invocation: true
---

Loading this skill does not arm a loop. Only the human can arm it from the
session using `/agent-loop-start`.

1. Reread the canonical ticket and linked TODO named in the
   continuation prompt, including after compaction. If either is missing or
   ambiguous, stop and ask the human. Do not guess from the repository.
2. Treat the TODO as the single ordered list of approved open tasks; the ticket
   defines outcomes and acceptance. Reconcile the whole TODO at turn start/end,
   but write only when task state/order, dependency, blocker, or acceptance proof
   materially changes. Remove finished tasks when they no longer guide open work.
   Keep at most three brief, unapproved topics under `Explore later`; do not append
   turn histories or repeated checks. Continue ready approved work rather than
   stopping after one task while more remains.
3. Leave permission grants, form responses, destructive actions, user-data
   cutover, closeout, and human-only acceptance to the user. Arming is not
   approval for those actions.
4. End your response with the checkpoint line from the continuation prompt.
   Keep the exact ID and choose the final word:
   - `ready`: verified evidence is recorded and approved work remains.
   - `blocked`: only human decision, permission, or access work remains, or
     the authoritative records are unavailable. State exactly what is needed.
   - `complete`: all non-deferred work has recorded verification. Summarize
     the evidence and name deferred work without marking it done.
