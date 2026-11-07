# Session audit: idea-first work and OpenCode worktrees

**Research date:** 2026-11-07. **Status:** evidence for discussion, not an accepted product contract.

## Finding

The session demonstrates a workflow worth supporting: shape an existing idea,
approve work, provision isolation, continue the same conversation, iterate with
the human, then deliver according to repository policy. The workspace is not
the starting point or the durable description of the work. The ticket is.

The directory move was real, not just a shell changing directories. OpenCode
also explicitly replaced the parent's repository instruction source. The testing
child was created in the new location. However, a child-specific record proving
its initial `AGENTS.md` injection is not present in the inspected message
history. Correct location, instruction discovery, and compliance are distinct
claims.

## Scope and evidence

Inspected through read-only OpenCode API requests:

| Session | Role | Messages inspected | Recorded location at audit |
|---|---|---:|---|
| `ses_e4bae403effeE89cEIZx2ded4L` | Human-facing parent | 202 | `~/programs/simgame/rust-main` |
| `ses_e4b959545ffeUOSSXQtUGBcPQ4` | Ticket-shaping child | 7 | Original checkout |
| `ses_e4b8d2d86ffevHEgfNRPGFMh5Z` | Reused testing child | 86 | Now-removed terrain worktree |

The parent spans approximately 04:43–06:14 UTC on November 7. Its 24 user
messages include shaping, authorization, corrections, visual feedback, and final
verification. There were 15 parent subagent calls: one shaping handoff and 14
handoffs to the same testing session. Parent-filtered session listing confirms
these two children. A nested delegation attempt failed; it did not create a
third session. [E1–E3]

Research inspected the current ticket conventions, archived ticket, project-mgr
source and specifications. It did not modify the Simgame checkout, execute its
tests again, resume an agent, create worktrees, or exercise project-mgr's native
GUI. Test outcomes below are historical tool evidence, not new test runs. The
image attachment was not independently rendered in this audit; conclusions about
the screenshot are limited to the conversation and subsequent actions.

## What happened

| Stage | Observed behavior | Product lesson |
|---|---|---|
| Start with an existing idea | The user selected `_tickets/stepped-terrain-rendering.md` and asked to shape it without implementing. | A work record can precede execution and an app-created container. |
| Resolve research permission | Local grooming guidance required source inspection, while the request initially prohibited it. The parent identified the conflict and waited for permission. | Discussing an idea and authorizing research are not implementation approval. |
| Shape the ticket | After a fixture was selected, a child edited the draft, leaving scope approval pending. | Delegated documentation is useful before code or worktree creation. |
| Authorize execution | The parent clarified that the later instruction authorized implementation. | A deliberate start boundary is useful; a capture action should not cross it. |
| Create isolation | The parent called OpenCode's worktree tool, copied the untracked ticket, moved its session, checked Git state, and created a named branch. | Isolation can be acquired when needed, without replacing the conversation. |
| Correct scope | The user corrected an isolated-preview interpretation: the normal renderer should change; the fixture was validation data. A later choice established gameplay `Coord.z`, not separate `Tile.height`, as the elevation source. | Polished ticket wording is not proof that the agent understood the intended outcome. |
| Implement and test | The parent changed production code; the same testing child added tests and validated successive changes. | A ticket can own a continuing collaboration, not a fixed set of prestarted workers. |
| Iterate visually | Settlement/tree elevations, textured faces, and debug outlines evolved through direct feedback. | In-scope feedback should return to the same work, not force another workspace or ticket. |
| Diagnose a missed visual problem | Passing helper tests did not establish outline visibility. The parent eventually identified outlines drawing before sprites and moved the overlay pass. | Automated success and human acceptance need separate evidence. |
| Deliver and close | After human verification, the parent committed, squash-landed on `master`, moved back, removed the worktree, then archived the ticket. | Delivery belongs to project policy; ticket, conversation, and worktree have different lifetimes. |

Sources: shaping and authorization [E4]; setup and moves [E5–E7]; testing and
visual feedback [E8–E10]; closeout [E11]; repository policy [L1–L4].

### “Automatic worktrees” needs a qualification

The agent automated this worktree setup because the selected-ticket repository
workflow requires a dedicated worktree before implementation. This is not
evidence that OpenCode always creates a worktree for a conversation. The shared
`gated-implementation` skill itself explicitly requires neither Git, worktrees,
nor subagents. Simgame supplies those policies. [L1, L3, L5]

The worktree creation result supplied a directory. The next Git status showed
`HEAD (no branch)`; the parent then ran `git switch -c
stepped-terrain-rendering`. Treating “worktree created” as “the intended named
branch is ready” would have been wrong in this session. [E5]

## Directory and instruction audit

### Parent: directory and instruction replacement are directly evidenced

1. `msg_1b4710eec001Rw6nKrycq7aqUI` called
   `tools.opencode.worktree_create`.
2. `msg_1b4713ad1001a1TK0wvTovMAiC` called
   `tools.opencode.session_move` for the parent, targeting
   `~/.local/share/opencode/worktree/1d64be/stepped-terrain-rendering`.
3. `msg_1b47142e60021F1C51cEMgjIRo` is a `location-switched` message recording
   both old and new locations.
4. `msg_1b4714453001xD6mZaGi7zAswF` is an instruction-update system message. It
   explicitly retires the source-checkout `AGENTS.md`, supplies the worktree's
   `AGENTS.md`, and updates the working-directory environment.
5. Closeout records the reverse move and a second instruction replacement.
   [E5–E7, E11]

These system messages explain what appeared in the root session: they reflect
the parent's own location change, not proof that a child moved the root.

### Children: the effective locations were appropriate for their jobs

- **Shaping child:** created before the parent moved; its session record names
  the source checkout. It read and rewrote the ticket there, and its shell check
  explicitly used that checkout. That was appropriate for shaping. [E2, E8]
- **Testing child:** created after the parent's move; its session record names
  the actual worktree. Its relative reads and patches targeted the implementation
  files, and the parent's later diff included the test changes. It was reused
  for all 14 testing handoffs. No child location move appears in its message
  history. This is consistent with inheriting the parent's location when first
  created, not continuously following the parent. [E3, E8–E9]
- **Instruction limit:** neither child's inspected message history contains an
  initial system message enumerating injected repository instructions. Neither
  explicitly read `AGENTS.md`. The testing child explicitly loaded
  `codesitter-analysis`, but this does not prove every local skill or instruction
  was injected or followed. Empty instruction-entry API results are not evidence
  that automatic repository instructions were absent. The attempted experimental
  log reads returned synchronization markers only, including with `after=0`;
  they did not establish the initial instruction baseline. [E8, E14]

The companion [OpenCode contract research](opencode-workflow-integration-research.md)
separates documented behavior, tagged-source behavior, and the remaining
instruction-provenance uncertainty. Do not present source-supported discovery as
a recorded child-specific injection proof.

### The correct path did not mean the latest source-checkout rules

The source checkout had uncommitted `AGENTS.md` changes when execution began.
The instruction message after moving used the worktree's committed guide. Its
text did not include the local addition about organizing code around cohesive
domain concepts; the instruction message on returning did include it. The
current source-checkout diff confirms that addition remains uncommitted.
[E5, E6, E11–E12]

The untracked ticket was explicitly copied into the worktree; other uncommitted
files were not. This is normal Git isolation, but a material usability concern:
users can reasonably expect their current project guidance to follow them.
An integration should disclose instruction differences, not silently copy a
dirty checkout or assume every checkout has identical guidance.

### A child outlived its worktree

At audit time the parent is back at the source checkout, but the testing child's
stored location still names the worktree that closeout removed. The child is
idle and succeeded; this is not evidence that work was interrupted or lost.
It is evidence that historical child sessions can retain a now-unavailable
execution location. Resuming one requires an explicit recovery decision, not a
blind attach or an automatic replacement conversation. A read-only filesystem
existence check also confirmed that the recorded directory was absent at audit
time. [E1, E3, E11]

## Critique of the agent collaboration

### Behaviors to preserve

- The parent respected the initial research boundary and the distinction between
  shaping and implementing.
- The shaping handoff specified established decisions, uncertainties, and the
  no-implementation boundary.
- Production and test ownership were mostly separated, with sequential
  handoffs rather than concurrent writers editing the same area.
- The testing child initially refused to invent a missing production API and
  proposed a test boundary instead.
- Later validation reported visual limitations, obsolete tests, warnings, and
  unmeasured performance rather than equating a passing suite with acceptance.
- The user remained in the same conversation through substantive visual
  iteration and delivery. Local changes in the source checkout were preserved.
  [E4, E8–E11]

### Friction not solved merely by adding tickets

- **An assumption became too authoritative.** The parent interpreted terrain
  height as the separate `Height` field and framed the work as an isolated
  experiment. Delegation carried that interpretation into a well-structured
  draft. The user later corrected both the execution surface and elevation
  source. A reviewable outcome and explicit unresolved decisions matter more
  than the length or polish of the ticket. [E4, E9]
- **Approval became repetitive.** Clarifying the transition from “shape only”
  to implementation was justified. Later, the parent asked permission for
  diagnostic work and stopped after promising to investigate; the user had to
  redirect it. A harness should distinguish consequential scope changes from
  ordinary investigation inside approved work. [E4, E10]
- **Testing was assistance, not independent review.** The parent supplied
  proposed helper seams to the same child that later validated them. This was
  useful test-first collaboration, but not an independent review of the whole
  renderer or user intent. Several green checks could not detect the visible
  outline problem. [E9–E10]
- **One regression test checks source text.** The final overlay test searches
  `draw_map` text to compare call positions. The child explicitly acknowledged
  that this does not prove rendered behavior. Preserve that limitation in the
  evidence rather than presenting another passing test as stronger acceptance.
  [E10, L4]
- **A hidden delegation limit mattered.** During validation, the testing child
  tried to launch a background `explore` agent. The tool rejected it with
  `Subagent depth limit reached (1)`. No grandchild exists. The child continued
  its own investigation. A root-only UI can miss this failed attempt; an
  integration should show meaningful failed child operations without requiring
  a full duplicate transcript. [E13]
- **The durable record was manually carried between checkouts.** The untracked
  source draft was copied into the execution tree, then preserved under
  `/tmp/opencode/stepped-terrain-closeout/` to avoid obstructing landing. The
  final ticket was archived from `master`. This worked, but copying ticket
  files and maintaining per-checkout active indexes is not a reliable global
  backlog protocol. [E5, E11, L1]

## Reproducible evidence references

Use `opencode api get` against the session's service. Message-list requests were
paginated; large CLI responses can be truncated and must not be treated as
complete JSON exports. No raw transcript is committed with this report.

- **E1:** `GET /api/session/ses_e4bae403effeE89cEIZx2ded4L` and
  `GET /api/session?parentID=ses_e4bae403effeE89cEIZx2ded4L&limit=100`.
- **E2:** `GET /api/session/ses_e4b959545ffeUOSSXQtUGBcPQ4`.
- **E3:** `GET /api/session/ses_e4b8d2d86ffevHEgfNRPGFMh5Z`.
- **E4:** Parent messages `msg_1b451c013001g0B3SfxMjM13O0`,
  `msg_1b452094900171k8vwBQsqYVES`, `msg_1b458cabd001RwOsn65f0nHbjp`,
  `msg_1b46a121c0015fkF2Q1T7kWpzQ`,
  `msg_1b470bedc001RBIEwrBbAyb5aa`, and `msg_1b470ffb7001wd6SZ8ysu57vFO`.
- **E5:** Parent messages `msg_1b470fffa001qGWSk246TUKDDN`,
  `msg_1b4710eec001Rw6nKrycq7aqUI`, `msg_1b4712fd100163kEsSvIDCe4ix`,
  `msg_1b4713ad1001a1TK0wvTovMAiC`, `msg_1b4714473001XDej7PhDSRDcDR`,
  and `msg_1b4715260001cI27AvXss58amY`.
- **E6:** Parent messages `msg_1b47142e60021F1C51cEMgjIRo` and
  `msg_1b4714453001xD6mZaGi7zAswF`.
- **E7:** Read a cited message with
  `GET /api/session/{sessionID}/message/{messageID}`.
- **E8:** Both children's complete paginated
  `GET /api/session/{sessionID}/message?limit=10` histories; parent handoff
  `msg_1b4718b02001ElqUrdk73aZsf4`.
- **E9:** Parent messages `msg_1b473a8460018nzk0kctSmlX52`,
  `msg_1b476774d001I44Gc5zcu9ys3w`, `msg_1b4770a0d001YEzCixp5uzPbAV`,
  `msg_1b478c3cd0014k67yfCMcoYgX2`, and
  `msg_1b47af2f2001CAil9MfevJkKUq`.
- **E10:** Parent messages `msg_1b49854f7001z2OSiTjfYaRwUS`,
  `msg_1b49a7014001a8ABQF2AcAF3FA`, `msg_1b49b2066001FRljRjDoYEz5t2`,
  `msg_1b49b61660016dC4srpC7A53lY`, `msg_1b49c098d001zBvQZHLBvFAUol`,
  `msg_1b49cb144001NsDl7hO4ap9LzB`, and `msg_1b4a2edeb001u5ZmaXdijySxim`.
- **E11:** Parent closeout messages from
  `msg_1b4a30aae001dPBCQPsX58kL0s` through
  `msg_1b4a4d793001ZWFuwhmqs2rOOZ`, including move
  `msg_1b4a41b96001cjJPIk59xMPW5S`, instruction replacement
  `msg_1b4a42f00001hZG2utsJarLzV2`, and removal
  `msg_1b4a42f13001rR41tY6yyVpx6s`.
- **E12:** Read-only `git diff -- AGENTS.md` in the source checkout on the audit
  date, compared with the instruction text in E6 and E11.
- **E13:** Testing-child message `msg_1b47b0cae0011zXzeEdRh6r69i`; also
  `GET /api/session?parentID=ses_e4b8d2d86ffevHEgfNRPGFMh5Z&limit=100`
  returned no children.
- **E14:** For each child, read-only
  `GET /api/experimental/session/{sessionID}/log?follow=false`, also tried with
  `&after=0`, returned only `log.synced` at sequence 44 (shaping) or 579 (testing).
  These were not complete historical event exports and do not prove an absence
  of initial instructions.

Local primary sources, relative to `~/programs/simgame/rust-main` unless noted:

- **L1:** `.agents/skills/ticket-management/references/repository-workflow.md`,
  especially selection/state, execution setup, and delivery.
- **L2:** `.agents/skills/ticket-management/references/capture.md` and
  `ticket-format.md`: low-filter draft capture and progressive shaping.
- **L3:** `.agents/skills/ticket-management/references/execution.md`: testing
  child ownership and sequential red/green handoff.
- **L4:** `_tickets/archived/stepped-terrain-rendering.md`: final scope,
  verification, limitations, and delivery reference.
- **L5:** `~/.agents/skills/gated-implementation/SKILL.md`, especially lines
  114–127: local delegation policy; no mandatory Git/worktree/subagent strategy.
