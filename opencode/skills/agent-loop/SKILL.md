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
2. The ticket defines outcomes and acceptance; the TODO is a short queue of open
   work, grouped into coherent user journeys where useful. After an item, take the
   next ready one. If the queue is empty while ticket outcomes remain open, rebuild
   it from those gaps and continue. Keep evidence in tests/artifacts, not TODO
   history.
3. Leave permission grants, form responses, destructive actions, user-data
   cutover, or closeout to the user. Arming is not approval for those actions.
4. End your response with the checkpoint line from the continuation prompt.
   Keep the exact ID and choose the final word:
   - `ready`: the turn completed and approved work remains.
   - `blocked`: only human decision, permission, or access work remains, or
     the authoritative records are unavailable. State exactly what is needed.
   - `complete`: all non-deferred work meets ticket acceptance. Summarize checks
     and name deferred work without marking it done.
