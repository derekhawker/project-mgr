---
description: Finish and deliver the assigned Workspace ticket
---

Finish and deliver the Workspace ticket assigned to this session.

Use the durable `workspace-ticket` assignment to identify the exact ticket. If it
is missing or ambiguous, stop and ask for the assignment; never infer the ticket
from the repository or UI selection. Read its canonical Markdown, linked
`.progress` file, current checkout, and applicable `AGENTS.md` instructions. If
the ticket is not approved for execution, stop and identify the approval needed.

Invoking `/end-ticket` is the user's explicit confirmation to begin the entire
closeout sequence for this ticket. Do not ask again for generic closeout approval.

First reconcile approved scope, request coverage, progress, actual changes, and
acceptance evidence. Continue all ready approved work and automated validation in
this session. Do not mark anything complete without its promised proof. Follow
project review, manual-verification, delivery, and cleanup rules.

If genuine human-only acceptance remains, finish all implementation, automated
checks, and review first. Then give one concise packet containing every remaining
acceptance item, how to inspect it, expected results, and what the checks do not
prove. Wait for that acceptance; when the user responds, continue closeout without
asking for the same authorization again.

Pause only for a real blocker, a consequential decision or scope change, an
unsafe/dirty checkout that delivery could affect, or required human acceptance.
Record the reason and next action in `.progress`; preserve the ticket as open or
blocked. Do not claim completion, merge, or remove worktrees while required proof
or delivery is blocked. When clear, execute the full project-required closeout:
commit and publish the ticket work, merge as project policy requires, record the
verified result, remove the clean ticket worktree/branch when required, and close
or archive the ticket. Keep unrelated user changes untouched.
