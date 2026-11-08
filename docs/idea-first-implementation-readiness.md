# Idea-first release: research and implementation readiness

**Status:** isolated feasibility experiments completed and independently verified;
the reviewed product decisions are recorded, including the final cleanup boundary.
Implementation planning and production validation remain. This is the durable
record for the authorized feasibility work, not permission to implement or
migrate live application data.

## User direction and request coverage

| Request | Disposition / evidence required |
|---|---|
| Research runtime lifetime/transport with a subagent; hypothesize, experiment, verify, and assess conclusions. | Dedicated runtime/storage investigation; results below must distinguish prototype evidence from production acceptance. |
| Use Markdown for tickets; raise other storage concerns. | Selected. Ticket content/lifecycle are canonical Markdown; operational metadata, approval receipts, recovery journals, and consistent backups remain distinct concerns. |
| Experimentally validate OpenCode integration unknowns with a subagent. | Separate native-operation and session-context investigations, using isolated installed-OpenCode fixtures and synthetic local providers where feasible. |
| Point out the human-decision UX for user review. | Reviewed; the user selected OpenCode session forms. See [human decisions](ticket-session-protocol-proposal.md#human-decisions-inside-the-opencode-conversation), [logical operations](ticket-session-protocol-proposal.md#bridge-operations-and-execution-authority), and [status transitions](ticket-session-protocol-proposal.md#ticket-status-and-session-activity-are-different). Runtime validation remains outstanding. |
| One release with migration of current workspaces, not an arbitrarily small first release. | Selected. Required core flows and eligible zero/single-repository workspace migration form one release. The user subsequently excluded multi-repository workspaces and rejected automatic ticket creation. Internal implementation slices may still be incremental. |
| Defer multi-repository execution until release two. | Selected. Release one supports one active repository or non-Git context per ticket run. Excluded multi-repository Workspaces are unlinked/cleaned up rather than retained in a legacy view; actual repositories and `~/OpenCode Projects/Repositories` are preserved. |
| Preserve existing notes collections and fit optional tickets into the model. | Notes/conversations remain useful without a ticket and their existing paths are preserved. The later user decision creates a local repository for both new and existing repo-free Workspaces; it does not move their notes or require tickets. |
| Keep the integration simple: persist session links, require a working plugin, and use `session.idle` to mark work Blocked. | User clarification accepted. Resume uses the durable session-to-ticket association; the plugin triggers the Rust idle fallback. See the [lifecycle rules](ticket-session-protocol-proposal.md#ticket-status-and-session-activity-are-different). Native “children” mean OpenCode subagents. |
| Support external ticket editing and Tools on every ticket view, as on Workspaces. | User requirement accepted. See [ticket Tools](idea-first-project-mgr-proposal.md#tools-stay-available-throughout-the-ticket-workbench). |
| Use OpenCode's shared service; quitting project-mgr leaves ongoing work running. | User approved. Project-mgr attaches as a client; the plugin continues while the GUI is closed; reopening reconnects to the same conversations. See [service ownership](idea-first-project-mgr-proposal.md#treat-service-ownership-as-a-product-choice). This changes the proposed runtime contract, not the currently running app. |
| Use explicit terminal forms to approve the complete plan and accept/request changes to the reviewed result. | User approved after the implementation flow was explained. Use existing OpenCode session forms, a Rust-recorded revision-bound request/answer, and the waiting plugin tool; no approval between implementation tasks. Production/native validation remains outstanding. |
| Create no migration tickets, including for existing work or ambiguous cases; exclude multi-repository workspaces. | Eligible workspaces retain their conversations/contexts with zero tickets. Multi-repository workspaces are not converted; the later user decision is to unlink their project-mgr records and clean up legacy resources, subject to confirmed targets. |
| Review the OpenCode Projects directory, managed repository library, and symlinks for both existing and new workspaces. | No mandatory Workspace folder, clone mirror or symlink. Both new and existing repo-free Workspaces get a local repo at `<repos dir>/<username>/<informative-repo-name>`. Reuse the configured repository root and local username namespace, with an editable proposed repository name. Keep `~/OpenCode Projects/Repositories`; remove only obsolete Workspace artifacts/aliases, not actual repositories. See [directory model](idea-first-project-mgr-proposal.md#opencode-projects-directory-and-repository-locations). |
| Store tickets outside repositories, grouped by Workspace; keep Quick Requests unchanged. | User accepted one configurable Markdown store with Workspace subdirectories, SQLite operational metadata and combined backups, without a required revision-history UI. Ungrouped capture retains an unassigned area. Quick Requests remain organization for random OpenCode asks, not automatically tickets. |
| Unlink excluded multi-repository Workspaces and clean up obsolete artifacts, preserving actual repositories. | User confirmed keeping `~/OpenCode Projects/Repositories` and all actual repositories/checkouts, while retiring Workspace artifacts and symlink aliases. This supersedes the tentative whole-root deletion option. Planning only: no unlink/deletion has run. |

## Experiments and conclusion policy

The user authorized bounded research/experiments. Each investigation must state
its hypothesis, observable success/failure criteria, actual setup/commands,
observations, verdict, and limitations. Tests against a fake local provider may
prove the installed OpenCode tool pipeline; they do not prove provider quality
or native terminal/Wayland acceptance. A standalone storage prototype does not
prove the production Tauri or plugin-to-Rust path.

Promote a conclusion only for what the evidence actually establishes:

- **Accepted:** directly supported by an executed relevant experiment.
- **Accepted with constraints:** supported only within the stated boundary.
- **Rejected:** the hypothesis's acceptance condition failed for the tested path.
- **Unproven:** source evidence or an incomplete fixture is insufficient.
- **User decision:** depends on product intent; experiments inform but do not decide it.

### Runtime and Markdown authority

Evidence: [runtime/storage experiments](ticket-runtime-storage-experiments.md).
The main investigator inspected the scratch implementation and independently
reran its documented command. **Exit 0; 16 experiment groups**, including 20
concurrent-writer races, injected exits/SIGKILL, recovery/retry, and negative
controls. Verification artifact:
`/tmp/opencode/ticket-runtime-experiment-2j31q2j3/runs/run-mp15cn42/results.json`.

| Hypothesis | Verified observation | Assessment accepted here |
|---|---|---|
| Per-request Rust core/stdio works without GUI or another daemon. | Separate processes and a separate in-process-core caller shared persistent state; real Node subprocess pipes returned bounded success/error JSON. | **Accepted as mechanism feasibility.** Recommend this over a new project-mgr daemon; actual installed-plugin integration/packaging still needs production tests. |
| Markdown plus an operation journal handles cooperating writers and known process-crash windows. | Exactly one winner per 20 two-writer races; expected conflicts; crashes before/after file replacement reopened and retried once. | **Accepted with constraints.** This is recoverable coordination, not a transaction across file/SQLite; operational approval/run recovery is not implemented by the prototype. |
| SQLite backup alone restores the ticket store. | A valid DB snapshot was inconsistent with later Markdown. | **Rejected.** A coordinated Markdown/staging/SQLite snapshot manifest is required. |
| Private stdin authenticates a session or human. | Fabricated caller labels did not establish verified identity. | **Rejected as a security claim.** Trusted plugin runtime capture plus Rust binding checks remain necessary; same-user unrestricted shell is not isolated. |

The fixture used tmpfs. Accepted recovery concerns process interruption, not
power-loss persistence. Illustrative startup timings were small on that fixture,
but do not establish production latency, cross-platform behavior, or a reason
to add a persistent server. No copy of ticket content/status was placed in SQL;
the intent stored hashes and a staged Markdown reference.

### Native operations and Code Mode

Evidence: [native-operation experiments](opencode-native-operation-experiments.md).
The main investigator inspected the isolated driver and independently reran it:
**exit 0; 64 assertions passed** against installed OpenCode v2.1.4, a loopback
scripted provider, real Code Mode, and unchanged native Git executors. Verification
artifact: `/tmp/opencode/opencode-native-experiment-sL53R2/run-1794040356398638866`.

| Hypothesis | Verified observation | Assessment accepted here |
|---|---|---|
| Native result can be tracked even if outer Code Mode output omits it. | Inner hooks and retained executor observed the real returned directory; Git confirmed the tree. | **Accepted.** Resource tracking need not rely on the model reporting the result. Real-model adherence to a repository reference is a separate behavior. |
| Closure-local IDs distinguish repeated/concurrent operations; gates precede effects. | Inner calls shared native call identity but had distinct wrapper IDs/directories; two native creates overlapped. Two rejection paths left Git unchanged. | **Accepted within the tested native path.** Concurrent identical-name collision and full Rust authority locking were not tested here. |
| Native failure can leave a real resource. | Startup `exit 47` occurred after real creation; inventory retained the tree and a pending-slot guard rejected another create. | **Accepted.** Persist intent and reconcile; never interpret every tool error as no mutation. |
| Interruption can bypass after hooks. | Real server interrupt after native completion left the tree and intent with no corresponding inner/outer after callback. | **Accepted.** After hooks are not a durable-finalization guarantee. The pause was deliberate, not an interrupted Git-internals test. |
| Move admission differs from application. | Immediate read remained at source; later read/event had destination. An explicit other-session target moved without moving its caller. | **Accepted.** Verify target and confirm application outside the originating callback. |
| Source plugin availability proves destination readiness. | An uncommitted source-only capability vanished after moving, while the privately global fixture bridge activated at destination. | **Rejected.** Global bridge availability and destination readiness must be checked independently. |

This fixture's operation journal is JavaScript research code, not the proposed
Rust journal. The accepted conclusion is native interception feasibility, not
production end-to-end correctness or universal observation of shell/direct API
effects. Both owned fixture listeners were stopped. No external provider or
live user session was involved.

### Session context, child admission, and moves

Evidence: [session-context experiments](opencode-session-context-experiments.md).
The subagent reported **29/29 assertions in two clean runs**, using the real
installed v2.1.4 native subagent/prompt/context/skill pipeline and a synthetic
loopback provider/authority. The main investigator inspected and independently
reran the fixture: **exit 0, 29/29 assertions, 28 loopback provider requests**.
Verification artifact:
`/tmp/opencode/opencode-context-experiment-20261107/run-hmzj_57u/evidence.json`.

| Hypothesis | Observed boundary | Assessment |
|---|---|---|
| Native child can be bound before first primary dispatch. | Prompt → exact assignment bind → context → provider; malformed/stale handoffs produced no child provider request. | **Accepted within the tested foreground path.** It is a before-generation gate, not an atomic before-create operation. |
| Nonsecret dispatch references support exact-child claims and reuse. | Valid native reuse continued the same child; mismatched reuse stopped; competing admissions yielded one bound child and one rejection. | Supported seam, not a durable Rust authority/role-enforcement proof. |
| Binding refresh follows the real session, not GUI selection. | A real tool continuation refreshed revision 2→4 while keeping ticket A despite synthetic GUI selection B. | Supported under an active bridge; production GUI selection code was not tested. |
| Bridge persists across moves and non-Git notes context. | Actual local guidance changed across source/destination; the ticket binding remained, including in a Git-free notes root. Unrelated unbound session got no ticket entry. | Supported runtime mechanism; a real workspace-notes binding/UX remains implementation work. Two scratch repo roots tested moves, not multi-repository orchestration. |
| Entry skill is explicitly attached, not merely discovered. | Actual prompt skill resolution and first provider requests contained the synthetic skill body. | Supported explicit activation seam; real-model reference reading and compliance were not tested. |
| A removable bridge provides unconditional fail-closed protection. | After plugin removal/reload, an authority-denied session still dispatched a primary request without ticket context. | **Rejected.** Required availability is not enforced atomically by plugin inventory checks. |
| Primary context hook covers every model request. | Actual transient generate used its own hook and lacked ticket context; compaction used a separate hook. | **Rejected.** Auxiliary traffic needs its own policy; automatic title behavior remains unvalidated. |

The gate's failure UX also matters: some prompt-hook rejections returned an empty
HTTP 500; a context failure could have successful admission/wait responses while
an assistant-message error recorded the actual failure. A typed bridge readiness
error and same-session retry are necessary. Successful HTTP admission is not a
successful work turn.

### Preserved executable fixtures

The fixture commits have been imported into this repository as local research
branches. They survive removal of the scratch directories; they have not been
pushed. Their standalone histories contain throwaway prototypes, not production
changes, and must not be merged into the application branch.

| Investigation | Local research branch | Commit | Preserved contents |
|---|---|---|---|
| Rust runtime/storage | `research/idea-first-runtime-20261107` | `9a9b0a2` | Fixture source, lockfile, original result JSON and build output. |
| Native operations | `research/idea-first-native-20261107` | `4857e14` | Driver and plugins; later run artifacts remain scratch-only. |
| Session context | `research/idea-first-context-20261107` | `324b0f4` | Driver and plugin; later run artifacts remain scratch-only. |

Inspect with `git show <branch>:README.md` or export the selected commit with
`git archive` into a new isolated directory under `/tmp/opencode/`. Read its
runner before rerunning: the fixtures use host-specific executable/scratch paths
and are not packaged portable test suites. Preserve the research reports as the
interpretation of the evidence; recovering source does not recover every run's
temporary artifacts. Local branches are not an off-machine backup.

## Other storage concerns raised now

Ticket format is settled; the following are separate from that choice:

| Concern | Proposed authority / constraint |
|---|---|
| Ticket text, title, scope, status, authored decisions, acceptance, next action | Markdown in an independent ticket home. IDs must survive rename/group/run changes. |
| Workspace organization, configured homes, rankings/views/settings | Existing SQLite management store, adapted to grouping rather than execution ownership. |
| OpenCode connection/session bindings, run/worker assignments, operation IDs and pending outcomes | Durable SQLite operational records; not a second editable ticket lifecycle. |
| Verified human scope/verification/delivery decisions | Durable receipt bound to scope revision/run; a Markdown status edit alone cannot manufacture authority. The receipt's representation is subject to the human-action UX decision. |
| Ticket discovery/search indexes | Derived cache, rebuildable from canonical Markdown. |
| Notes/resources | Existing ordinary files and paths; no compulsory ticket, Git repository, or file move. |
| Conversation history and task prompts | OpenCode only. No transcript copy in Markdown or operational tables. |
| Legacy Quick Request original prompts | Existing SQLite exception, explicitly preserved unless a separately agreed conversion changes that product concept. |
| Backup/restore and migration | A coherent generation of Markdown plus operational database/manifest; backing up either one alone cannot restore all authority and pending operations. |

## Notes-only workspaces

The release needs two explicit context types, not “a ticket is always active”:

The later directory decision gives both new and existing repo-free Workspaces
a local repository; it supersedes a permanently repo-free Workspace default.
Existing non-Git notes roots and conversations remain valid retained context,
not files to move into that new repository automatically. Notes are optional;
creating the local repo does not create a notes folder or a ticket.

1. **Workspace context:** discuss the project or read/maintain explicitly selected
   documents. A session knows workspace identity and its verified context, but
   has no fabricated ticket/run. A newly linked local repo is the context for
   future sessions; historical sessions retain their exact locations unless moved
   explicitly. Existing document reading has no Git precondition.
2. **Ticket context:** track a selected outcome. For notes/document work it
   references the collection and uses its existing non-Git directory. Scope,
   progress, evidence and review apply; branch/worktree/commit/merge rules do not.

Creating a collection does not create a session. Opening its notes does not
create a ticket. A workspace conversation can capture a ticket when asked; an
explicit selection/binding starts ticket discussion. Notes remain in place and
are linked, not copied into every ticket or run.

Preserve the current Docs reader rather than make a new editor a hidden release
dependency. Offer workspace Tickets/Notes/Conversations destinations and remember
the selected view. A migrated notes collection should not open on an empty task
board while hiding its existing documents and useful conversations.

## Migration boundaries and evidence

### Source inventory

Current records already distinguish Workspace home, exact session directories,
repository worktrees, and legacy Task snapshots. Relevant primary sources:

- `app/src-tauri/src/migrations/0001_management.sql`: Workspace/Task/session
  relationships, current active/completed states, immutable session-owner/path
  trigger, and Quick Request data constraints.
- `0018_workspace_work_contexts.sql` and
  `0024_workspace_session_context_roles.sql`: Workspace/home, orchestrator, and
  worker role/directory assumptions that cannot simply become ticket bindings.
- `management.rs::archive_legacy_regular_tasks` and
  `management::tests::historical_task_rows_are_archived_before_conversion_without_touching_files`:
  historical snapshot and retained-files precedent.
- [Existing Docs behavior](ux/screen-docs.md): reader over Workspace homes and
  verified repository roots; not an existing rich-text notes editor.

### Required mapping, not yet executed

- Preserve eligible zero/single-repository workspaces' identity and home/notes/
  resources, tags, context associations and conversations in the organizational
  model. Existing multi-repository workspaces are excluded from conversion and
  follow the user's separate unlink-and-cleanup direction.
- Create no tickets during migration, for existing work or ambiguous cases.
  Every eligible workspace may have zero tickets; no classification/seed-ticket
  interview or transcript reconstruction is needed. User-requested future ticket
  creation is a separate operation.
- For workspaces with zero original repository associations, create/register/link
  one local repo under the selected username/name convention. Persist intent and
  path ownership so retries recover partial initialization or reuse its result,
  rather than duplicate the repo or overwrite a colliding user directory. Keep
  existing files and exact session locations; do not initialize Git in their old
  notes home or move those files/sessions merely to match the new convention.
- Preserve legacy active/completed provenance. A legacy completed record is not
  new verification evidence; a legacy active record is not permission to execute
  under a newly invented scope. Preserve workspace-level provenance without
  fabricating ticket lifecycle or approval records.
- Do not convert excluded multi-repository workspaces or choose a single repository
  for them. Unlink their project-mgr records and clean up approved legacy targets,
  with a backed-up manifest and recoverable cleanup state. Unlinking does not
  authorize deletion of native OpenCode conversation history. Do not follow a
  symlink into a shared repository and treat its target as disposable.
- Preserve historical Task archives and Quick Requests; no accidental resurrection,
  prompt-copy expansion, or deletion as a shortcut to the new model.
- Journal deterministic file/record mappings, verify backups, and recover partial
  migration before accepting further writes. Never run the proposed migration on
  live application data during this research.

### Concrete mapping cases for review

| Existing workspace | Proposed migrated representation | Preserved / not inferred |
|---|---|---|
| Notes collection, no repo or session | Preserve collection/files; create/link its local repository; zero required tickets or sessions. | Existing document paths; no automatic notes folder, file move, or invented work/session. |
| Repo-free notes collection with useful conversations | Preserve collection and exact conversations; create/link its local repository for future session context. | Historical locations remain exact; no automatic session move or ticket. |
| Repo-free unfinished or ambiguous effort | Preserve workspace/documents/conversations; create/link its local repository; zero tickets. | No seed-ticket prompt, classification guess, or fabricated intent/approval; initialization is retry-safe. |
| Single-repo unit of work | Same workspace and existing contexts/conversations, with zero tickets. | No imported ticket, new clone/tree/session, transcript extraction, or fabricated approval. |
| Completed eligible regular work | Preserve completion/archive visibility with zero tickets; create/link a local repo if it originally had none. | No newly verified ticket acceptance, cleanup, automatic reopen, or agent start. |
| Multi-repo work | Excluded from conversion; unlink project-mgr records and remove obsolete Workspace artifacts/aliases through a recoverable cleanup manifest. | Preserve actual repositories/checkouts, `~/OpenCode Projects/Repositories`, native OpenCode history, symlink targets and this active checkout. No whole-root deletion or cleanup during review. |

The user selected no automatic tickets and exclusion of multi-repository
workspaces from conversion, then explicitly chose unlink/cleanup instead of a
legacy view. Those rules supersede the earlier imported-ticket/leave-intact mapping.
Implementation/migration correctness has not been validated against live data.

The schema currently makes session owner/directory immutable and constrains roles
to workspace/orchestrator/worker. New ticket and mutable-context associations
therefore need a new migration/binding representation; changing the GUI labels is
not enough. Preserve historical rows/snapshots, then verify the new mapping.

If an old session is still executing, preserve/observe it and reach a safe boundary
before changing its managed binding or submitting new prompts. Data migration
must not imply a second runtime owner, duplicate initial prompt, or automatic
resumption. Reliable zero-disruption upgrade during an arbitrary in-flight tool
has not been established and is not claimed by the single-release decision.

### Validation record

The existing historical archive test passed as a narrow preservation baseline:

```sh
cargo test --manifest-path app/src-tauri/Cargo.toml --lib management::tests::historical_task_rows_are_archived_before_conversion_without_touching_files -- --exact
```

**Result:** 1 passed, 0 failed, 166 filtered out. It exercises the production
historical upgrade on isolated file-backed SQLite and verifies retained user
files and archived path/session/cleanup metadata. It does **not** implement or
validate the new Markdown-ticket migration. New migration fixtures and all
production/native migration acceptance remain implementation work. No live
database or filesystem was migrated.

The current repo-free document workflow also passed through the production store
and reader, without provisioning Git or starting OpenCode:

```sh
cargo test --manifest-path app/src-tauri/Cargo.toml --test docs_reader_integration production_reader_loads_workspace_home_document_relative_to_workspace -- --exact
```

**Result:** 1 passed, 0 failed, 1 filtered out. It verifies Workspace-home
Markdown discovery/read and ignore rules in an isolated non-Git directory.
This supports preserving the notes collection foundation; it does not validate
the proposed workspace conversation binding, ticket model, or new UI.

## Human-decision UX to review

The user-approved interaction is in
[Human decisions inside the OpenCode conversation](ticket-session-protocol-proposal.md#human-decisions-inside-the-opencode-conversation).
Use OpenCode session forms at scope/plan approval and result verification, rather
than relying on an agent's interpretation of free-form “go.” Approval covers the
agreed whole plan, not each implementation task. The user accepted the described
form → reply event → Rust validation/record → waiting-tool continuation flow;
its production implementation and native interaction have not been validated.

There is a provenance limit, not yet an accepted enforcement claim: v2.1.4's
[session form reply route](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/protocol/src/groups/session.ts)
accepts `Form.Reply`, and the
[form schema](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/form.ts)
records an answer/state without a distinct authenticated-human actor field.
A form receipt alone therefore does not establish independent human identity
against another client with the same server authority. The proposed bridge must
define a trusted client action path and its actual threat boundary; do not claim
cryptographic human attestation from the generic form event. This source finding
does not demonstrate an exploit or invalidate forms as a normal user interaction.

## Overall readiness and important decisions

### Recommended architecture supported by the evidence

Use canonical Markdown tickets plus SQLite operational metadata, a shared Rust
core called in-process by Tauri and through a one-shot JSON-stdio adapter by the
OpenCode-side bridge. The bridge lives with the selected OpenCode service, not
the GUI window. Native executor wrappers journal intent/result with per-invocation
operation IDs; prompt/context hooks attach current session-scoped context and
explicit entry skills, including exact-child native assignments.

This preserves the vision: ideas before setup, useful continuing conversations,
native worktrees/delegation rather than a replacement agent runtime, and optional
tickets inside ordinary notes collections. No experiment justified adding a
separate project-mgr daemon or restoring mandatory upfront workspace provisioning.

**Assessment:** the core runtime mechanisms are now credible implementation
inputs, not source-only guesses. They are not a completed feature or unconditional
safety guarantee. Three independent fixtures were rerun by the main investigator;
the two existing production preservation/reader baselines passed. Native external
provider, GUI/Wayland, packaging, full Rust authority integration, and new migration
remain implementation/acceptance work, not claimed passes.

### Decisions and implementation constraints

No material product decision is currently queued. The user selected cleanup of
obsolete Workspace artifacts and symlink aliases while preserving actual
repositories and `~/OpenCode Projects/Repositories`. The earlier whole-root
deletion alternative is closed. Safe ownership/retention manifests, canonical
path resolution, active-usage protection, combined backup and retry/reopen recovery
are implementation requirements to prove, not more choices to offload to the user.
The user approved the complete implementation handoff on 2026-11-07. That
approval does not authorize live cleanup or migration.

### Resolved integration direction after user review

Ticket storage is one configurable Markdown home outside repositories, split by
Workspace; an unassigned area supports capture without a Workspace. SQLite holds
operational metadata, and backup covers both. A dedicated revision-history UI
is not required. Reuse the configured repositories directory and local username
namespace; show the informative repository name for editing before creation.
Quick Requests remain unchanged as organization for random OpenCode asks, with
their existing lifecycle/conversations and original-prompt storage exception.

The user rejected a legacy view for excluded multi-repository Workspaces and
selected database unlink plus cleanup. After considering whole-root deletion,
the user explicitly selected removal of obsolete Workspace artifacts while
preserving actual repositories and `~/OpenCode Projects/Repositories`. Retire
symlink aliases without using or following them as repository locations. This
supersedes both the leave-intact rule and tentative whole-root deletion. No cleanup
has run. Read-only inspection on 2026-11-07 listed the old root and ran
`git rev-parse --show-toplevel --path-format=absolute --git-common-dir`:

- Active worktree: `~/OpenCode Projects/Repositories/github-com/derekhawker/project-mgr.worktrees/workspace-quick-1792865797912-0`.
- Common Git repository: `~/OpenCode Projects/Repositories/github-com/derekhawker/project-mgr/.git`.

These paths and their contents are retained. Actual repositories outside the
`Repositories/` subtree are protected too. Inventory exact obsolete targets and
retained nested repositories before unlinking, resolve stored aliases to verified
canonical paths, remove only the symlink entry, and retain recoverable cleanup
state after owner-record removal. Do not treat ambiguous user files as artifacts
or delete a parent containing a retained repository. Backups live outside cleanup
targets. Planning approval does not run cleanup or stop the user-owned runtime.

Both new and existing Workspaces without a linked repository get a regular local Git
checkout at `<repos dir>/<username>/<informative-repo-name>`, with the username
acting like an organization namespace. No remote or publishing is required.
Workspaces using existing repositories reuse them. There is no mandatory separate
Workspace folder, automatic notes tree, managed clone mirror, or symlink layer.
OpenCode manages worktrees when work needs isolation. Standalone idea/ticket
capture remains repository-free. The user explicitly confirmed both new creation
and existing repo-free Workspace migration. Existing notes/files and historical
session locations are preserved; the new linked repo supplies future context,
not a reason to move old data or live sessions. Repository defaults are selected;
the repository root and real checkouts remain in place through legacy cleanup.

**Narrow Git verification:** on 2026-11-07, an isolated fixture at
`/tmp/opencode/greenfield-git-check-yy3ye5w8` initialized a local `main` branch.
`git worktree add --detach` failed before the first commit (exit 128), then
succeeded after an empty initial commit; `git ls-tree` showed no committed files
and `git remote` showed no remotes. Fixture-only author configuration and disabled
hooks/signing were passed per invocation; no global config or live data changed.
This supports recommending an empty initial commit for greenfield repos, not a
claim that the production creation workflow or installed OpenCode bootstrap has
been tested. Its Git commands are independently reproducible on a scratch repo.

Migration creates no tickets for existing work or ambiguous cases. Eligible
workspaces remain useful with zero tickets and their existing conversations and
repository contexts. Multi-repository workspaces are excluded from conversion;
the later unlink/cleanup decision above supersedes preserving their app records.
The automatic/imported-ticket proposal is also superseded. Cleanup is bounded to
obsolete artifacts/aliases with actual repositories retained; exact manifests
and safe recovery require implementation validation. No live cleanup or migration
is performed by this document review.

Scope/plan approval and result verification use explicit OpenCode session forms,
as approved by the user. Registered requests identify the ticket/session and
exact reviewed revision; Rust commits the answer idempotently and the waiting
plugin tool returns the outcome. Stale or cancelled forms grant no approval.
Reuse a valid decision across the complete plan instead of asking between tasks.
This records a product decision, not a completed or authorized implementation.

OpenCode service ownership is settled: use the shared service also used by the
CLI. Quitting project-mgr detaches the UI without stopping agent work or the
plugin. Reopening reconnects to the same sessions, without duplicate starting
prompts or a second owner. Safe transition from the current app-owned runtime,
authentication/connection identity, and native close/quit/reopen behavior still
need implementation and acceptance evidence. No extra project-mgr daemon or
additional private-server mode is required by this decision. Ordinary app-owned
shell/tool terminal persistence is separate from shared OpenCode agent execution.

Every ticket view exposes Tools using the Workspace pattern, including access to canonical Markdown before execution setup.

Current Tools evidence: `app/src/views/repository-tools/RepositoryToolsMenu.jsx`
provides terminal, IntelliJ and folder actions plus repository scripts; its
controller passes owner identity, and `app/src-tauri/src/os_handoff.rs` resolves
only an active regular Workspace home. Ticket/file targeting is therefore a
required extension, not already implemented support. Current UX/workflow docs
were reviewed; they continue to describe the shipped/current Workspace behavior,
while the proposed ticket extension is recorded in the product proposal.

The user requires a working OpenCode plugin and a simpler event-driven fallback.
Host-level enforcement against deliberate plugin removal is not a prerequisite.
Missing-plugin detection, repair and reconciliation remain normal integration
responsibilities; no claim is made that a removed plugin can stop OpenCode.
The reproduced fail-open is a known boundary, not a remaining user decision.

The user reaffirmed this direction: the plugin is necessary, and the response
to that dependency is to make it robust. Acceptance must cover reload/reconnect,
durable links, duplicate events, adapter/store failures, and recovery of uncertain
native operations without duplicate effects. Disconnection is not evidence of
session idle or completion. Reuse the existing journal/reconciliation contract;
no separate plugin supervisor or mandatory OpenCode host guard is requested.

Persist ticket linkage by exact session ID before managed work and reuse it on
resume. Do not conflate losing that association with failing to refresh current
ticket context. The plugin observes native tool results for attributable worktree
creation; inventory events/Git scans discover and reconcile other changes without
guessing their owner. Native child sessions in these documents are subagents.

For an In-progress ticket, `session.idle` from its linked owner triggers Blocked
with an idle/waiting reason through Rust, even if the agent omitted a checkpoint.
Preserve explicit review/completion and other lifecycle states. Subagent idle is
not owner idle. Resume clears only an idle-derived block under current approval.
This revises the previous checkpoint-only design; the old experiments did not
test this new lifecycle transition. Production event ordering/reconnect and
frontend/backend contract validation remain implementation acceptance work.

### What is sufficient now

The architecture has credible feasibility evidence and the product decisions
above are recorded. The task-based single-release implementation plan is
approved, while production acceptance gates remain. There
is not yet enough to promise uninterrupted managed enforcement through plugin
removal or migration correctness. Those are
specific limits, not invitations for a coding agent to invent policy.

The single release still includes backlog, Markdown authority, ticket/session
context and status, native single-repo worktrees/children, recovery, notes-only
workspaces, and existing-workspace migration. Internal incremental commits and
test fixtures do not change that release commitment. Multi-repository
orchestration is the explicit release-two exception.

## Requirements for the implementation plan

The [implementation-plan handoff](idea-first-implementation-plan.md) now assigns
the reviewed requirements and concerns to bounded tasks and a final full-release
E2E integration task. The user approved the full handoff on 2026-11-07;
approval alone is not evidence of completed implementation or live rollout.
Task status and execution evidence belong there; this assessment remains the
decision/research record. Explicit migration and preservation requirements remain
in scope; live rollout and external-provider calls require separate authorization.

Use the reviewed decisions and linked specifications when authoring the
implementation plan; bring back any newly discovered material scope conflict
rather than inventing policy. The user requires the eventual plan to:

- Divide the complete release into multiple bounded tasks, not partial product
  releases. Each task identifies its outcome, dependencies, responsibilities,
  exclusions, expected deliverables, and task-specific validation/pass criteria.
- Reference the product proposal, operating contract, and research by section
  rather than reproduce their specifications. Resolve contradictions in those
  source documents instead of adding competing rules to the plan.
- Give the final task ownership of full-release integration and end-to-end
  evaluation. It must provide executable setup/actions, expected observations,
  evidence to retain, failure/recovery checks, and cleanup for the completed
  release, including existing-workspace migration and notes-only workflows.
- Distinguish deterministic automation, installed-OpenCode/provider checks, and
  manual native terminal/Wayland acceptance. Passing isolated storage or browser
  checks must not be reported as completed native acceptance.

These are planning constraints, not the task breakdown or release acceptance.
Plan approval, implementation evidence, and authorization for live operations
remain distinct.
