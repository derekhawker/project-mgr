# Workspace Ticket Workflow Proposal

**State:** Tasks 1–5 approved for implementation; task 6 remains deferred.

**Workspace creation update (2026-11-10):** Workspace creation uses a direct
form, not an OpenCode proposal. Users either link a registered repository or
create an empty repository at
`<configured repository-library root>/<username>/<workspace-slug>/`. This
approved ticket-specific change supersedes the older creation path below; it
does not change the ticket **Work** flow.

## Main task

**Implementation tasks:** 1–5 approved by the user in this conversation on
2026-11-08; task 6 is not approved for execution.

1. [x] Make the `rust-main` ticket skill globally available.
   **Proof:** OpenCode discovers it from a repository-rooted session.
   **Outcome:** The adapted `ticket-management` skill and workflow references are
   maintained in `opencode/skills/ticket-management/`; the global OpenCode skill
   entry is a symlink to that repository source.
2. [x] Create Workspace ticket files and make them visible in the app.
   **Proof:** create a draft, restart the app, and confirm it appears with its
   Markdown status; change the file's status and confirm the list reflects it.
   **Proof (2026-11-08):** The user confirmed the native draft creation,
   app-reopen persistence, and Markdown status-refresh checks in this conversation.
   Added single-repository
   creation, Markdown discovery and refresh, and an OpenCode creation session
   with a session-scoped directory grant and instruction entry. Rust library
   tests passed; focused frontend adapter/controller/wire tests passed
   (55); the production frontend build passed. The session HTTP route has a
   focused mock test. The full frontend suite remains red: 287 of 314 passed,
   with 27 failures matching the previously documented failure count. The
   updated frontend composition test passes with ticket-first navigation.
3. [x] Build the simple ticket list before adding ticket-session behavior.
   **Proof:** select a ticket from the list and see its content truncated.
   **Proof (2026-11-08):** `node --test app/test/workspace-ticket-viewer-dom.test.js`
   passed 2 DOM tests covering selection without session work, truncated content,
   status, and archive selection. The frontend build passes. Native appearance
   remains unverified. Selecting a Workspace no longer restores a session.
4. [x] Add basic ticket-session resume behavior. See
   [`ticket-session-protocol-proposal.md`](ticket-session-protocol-proposal.md).
   **Proof:** work on a ticket, leave and return, and resume that ticket's same
   OpenCode session.
   **Proof (2026-11-08):** The user confirmed native exact-session resume after
   leaving and returning in this conversation. A below-handler filesystem/fake-runtime test
   exercises creation, exact-ID resume, confirmed-missing replacement, network
   error, repository cwd and fresh Markdown status without copying ticket body.
   The frontend Work action is wired. Non-cooperating external writers can still race file replacement;
   do not claim fully atomic concurrent editing.
5. [x] Put Change Review, Docs, and repository tools under the selected ticket.
   **Proof:** these destinations require a selected ticket and use its repo.
   **Proof (2026-11-08):** The user confirmed these native destinations require
   a selected ticket and use its repository in this conversation. Rust validates the
   explicit ticket and sole verified repository before opening these destinations
   or tools. The frontend propagates the selected filename and scopes session
   tabs to the selected ticket. Focused filesystem/store, context-propagation and
   session-scope tests pass.
6. [x] Improve the ticket viewer.
   **Proof (implementation, 2026-11-09):** The Workspace ticket browser now has
   compact status rows, a selected-ticket reader with complete sanitized Markdown
   and formatted frontmatter, status/modified/title sorting, row-level Work, and
   filesystem modification timestamps. Selection remains separate from Workspace screen
   tools. The post-Work options panel was removed, terminal-ready clears the
   initial loading status, and the Workspace screen heading includes ticket context.
   Focused frontend checks (29 tests), the ticket command-contract check, the
   frontend build, 181 Rust library tests, and `git diff --check` pass. A dev
   browser run on port 1421 verified fixture-backed sorting, archive browsing,
   selected-reader content and scrolling, selection/Work separation, mock Work
   handoff, heading, loading status, options removal, and a 640px layout with no
   horizontal document overflow. The fixture and command contract now include
   `modifiedAt`. The full
   frontend suite has 23 source-contract failures (284/307 passing); matching the
    previously observed failure count does not establish identical baseline
    failures. The user completed manual inspection of the desktop/narrow layout,
    scrolling, Work handoff, and breadcrumb, and confirmed all manual checks were
    complete on 2026-11-09. Native Wayland verification is not a completion gate
    for this task.

### Integrated validation and limitations

- `cargo test --manifest-path app/src-tauri/Cargo.toml` passed (177 library
  tests plus the integration test binaries).
- `npm run build --prefix app` and `git diff --check` passed.
- `npm test --prefix app` passed 287 of 314 tests; 27 source-contract failures
  remain, matching the previously recorded baseline count. A matching count is
  not proof that every failing assertion is identical to the baseline.
- The user confirmed all manual ticket-view checks complete on 2026-11-09. Native
  Wayland verification is not required for this task. The full frontend suite
  remains red as noted above; exact baseline equivalence is not established.
- Non-cooperating external writers can still race a Markdown replacement between
  comparison and rename. Preserve the ticket if a mismatch is detected; no
  universal cross-process atomic-write guarantee is claimed.

Do not duplicate the detailed requirements in the task list; this document and
the linked research carry them.

**Source precedence:** This proposal and its recorded decisions supersede
conflicting material in the older session protocol. That document is research,
not an additional task list or an authorization for its earlier migration,
managed-bridge, ticketless-workspace, or lifecycle proposals. Use only material
consistent with this proposal. The old database has already been deleted; do
not add a database reset, backup migration, or legacy-association migration task.

## Current summary

Selecting a Workspace should lead first to a ticket viewer. Each Workspace is
associated with exactly one repository. The user either selects a registered
repository or creates a local Git repository in the configured repository
library; the latter requires a short description and uses
`<library-root>/<username>/<workspace-slug>/`. The Workspace links directly to
that repository and has no separate home directory. Creation does not start
OpenCode. Workspace and repository records live in SQLite. Each Workspace owns
Markdown tickets stored outside Git under the
application data directory. OpenCode sessions guide ticket
creation and work. The Markdown ticket is the source of truth for ticket status
and records the one OpenCode work session needed to resume work. Workspace screen
destinations and tools are entered through a selected ticket; a ticket is
required to work.

This approved ticket-specific creation scope supersedes the older proposal and
the zero/multiple-repository assumptions in
[`workspace-refactor-target.md`](workspace-refactor-target.md) for Workspace
creation. Existing ticket and later **Work** behavior remains the source of
truth for ticket sessions.

## Request coverage

| Ask | Disposition | Coverage |
|---|---|---|
| Make a substantial UI improvement and document its requirements collaboratively. | In scope | This draft; detailed acceptance checks and implementation slices remain open. |
| Make each Workspace directly link to one repository; allow a registered repository or create a local Git repository if needed, without a separate Workspace directory. | In scope | The approved creation update above; empty repositories use the configured library root and require a short description. |
| Make the ticket viewer the primary Workspace screen, with a selectable ticket list and a way to work on a ticket. | In scope | Tasks 3–4. |
| Store each Workspace's Markdown tickets outside the repository, in Workspace-owned storage. | In scope | Storage location section. |
| Follow the ticket format and creation guidance from `rust-main`; make its ticket skill global. | In scope | Global skill and its guidance are required for ticket creation, clarification, and work flows. |
| Start or resume an OpenCode session in the repository for ticket work, and record enough in the ticket to resume it. | In scope | Task 4. |
| Use one OpenCode work session per ticket. | In scope | Session association section. |
| Create tickets through an OpenCode-driven UX rooted in the repository, following ticket-skill guidance. | In scope | Tasks 1–2. |
| Create tickets with `draft` status; keep the Markdown ticket authoritative for all statuses. | In scope | Status ownership section. |
| Keep ticket-session instructions concise and prove session resumption. | In scope | Task 4; see linked session research. |
| Start with a simple list that truncates ticket content, and track a task to improve the viewer. | In scope | Tasks 3 and 6. |
| Require a selected ticket for Change Review, Docs, and repository tools. | In scope | Task 5. |
| Execute the existing task list in order, with observable proof recorded for each task. | Tasks 1–5 approved; Task 6 deferred | Defer discussion of Task 6 until the others are done, as requested by the user. |
| Preserve existing worktree changes and reuse the running live runtime. | In scope as execution constraints | All tasks; do not restart the runtime without explaining a demonstrated need. |
| Respect frontend/backend test boundaries and avoid end-to-end tests. | In scope as execution constraints | Focused tests below command handlers and separate frontend tests; manual proof where applicable. |
| Keep integration in the main session and delegate independent outcomes when useful. | In scope as an execution constraint | Ordered tasks; parallel work only with clear ownership and dependencies. |

## Proposed requirements captured so far

### Workspace and repository

- Apply these Workspace and ticket rules uniformly to every Workspace in the
  clean-break product model; no prior Workspace or repository is a special
  case.
- A regular Workspace has exactly one associated repository.
- The user either selects a repository registered in the Repositories view or
  creates an empty local Git repository. The empty-repository path requires a
  short description, assumes no remote, and creates the repository under
  `<configured repository-library root>/<username>/<workspace-slug>/`, creating
  the username directory if needed. The Workspace links directly to the
  registered or newly created repository.
- Workspace creation is a direct form and does not start OpenCode. A selected
  repository name supplies an editable, word-spaced title suggestion. Starting
  or resuming OpenCode remains part of the later ticket **Work** action.
- Creating a Workspace must not create a separate Workspace home directory under
  `~/OpenCode Projects`. Workspace/repository metadata stays in SQLite; the repo
  directory is the sole code working directory, and ticket files live under
  `<app_data_dir>/workspace-tickets/<workspace-slug>/`.
- The old database has already been deleted; database deletion is not an
  implementation task. Do not carry forward prior repository associations.
- Selecting a Workspace opens its ticket viewer as the primary screen.
- Selecting a ticket selects its context; a separate explicit **Work** action
  opens or resumes that ticket's session. Selecting a ticket alone does not
  start an OpenCode session or change ticket status.
- Existing work destinations and tools—including OpenCode terminals, Change
  Review, Docs, and repository tools—are scoped under a selected ticket. Users
  must select a ticket to work; these are not independent Workspace-level work
  destinations.

### Ticket files and lifecycle

- Each Workspace has its own Markdown tickets under
  `<app_data_dir>/workspace-tickets/<workspace-slug>/`, outside the repository
  and therefore outside Git. Closed tickets use `archived/<slug>.md`, following
  the `rust-main` convention.
- The main ticket list shows non-archived tickets by default. Provide a separate
  way to browse archived tickets; the UI does not itself archive tickets or
  change their status.
- Start with a simple ticket list. Each entry shows ticket identity and
  Markdown-backed status, plus truncated ticket content; provide the explicit
  **Work** action for the selected ticket. A separate full-ticket detail layout
  is deferred.
- Use the `rust-main` ticket conventions as the starting format and follow its
  ticket skill for creation. Making the skill and its applicable guidance
  globally available is required in this task; the ticket experience depends on
  it for its workflows.
- A newly created ticket starts in `draft`.
- Ticket status is changed through the OpenCode session and recorded in the
  Markdown ticket. The app reads and displays status; it must not independently
  change or override it.
- Draft tickets may be clarified and expanded; draft status does not prevent
  further ticket authoring.

### Ticket creation and work sessions

- Creating a ticket is an OpenCode-driven interaction rooted in the Workspace's
  repository, with the ticket skill guiding the work.
- Use OpenCode's session instruction-entry API to give each ticket-related
  session Workspace-specific context. The Rust OpenCode client calls
  `PUT /api/experimental/session/{sessionID}/instructions/entries/{key}` with a
  JSON `value`, keyed by the exact OpenCode session ID. For ticket creation,
  attach the repository root, canonical Workspace ticket directory outside the
  repository, and direction to follow the global ticket skill and save a new
  `draft` there.
- For ticket work, attach a barebones assignment in a durable entry (for
  example, key `workspace-ticket`) containing only useful identifying/routing
  metadata: ticket title/slug, filename and canonical Markdown path, current
  status, Workspace ticket directory, repository root, and global ticket skill
  reference. Do not include or duplicate ticket body/content. Direct OpenCode to
  read the canonical Markdown file for its content and latest status, and treat
  that file as the status/progress authority. Ensure the OpenCode process has
  read/write access to that path. The explicit assignment plus file access is
  sufficient; no second ticket-content copy or ticket registry is required.
  Never infer the assigned ticket from the shared repository directory or
  current UI selection.
- Create or refresh the entry for the ticket's one exact session before opening
  its interactive terminal; refresh the current status from Markdown when
  restoring it. `work_session_id` is the sole ticket-session binding. The
  new-session control creates and attaches a replacement first, switches the
  ticket binding only after attach succeeds, then closes the prior session's
  terminal. Older OpenCode conversation history is not deleted.
- New ticket sessions use the ticket's associated verified worktree when present;
  otherwise they use the Workspace's verified repository checkout. After
  attaching a ticket session, read OpenCode's actual session directory and record
  any worktree OpenCode assigned during session creation. A stale or unrelated
  recorded worktree is an error, not a fallback. Existing OpenCode conversation
  history remains OpenCode-owned.
- Closing a ticket tab closes its terminal and clears the ticket's sole session
  binding. Closing does not delete the OpenCode conversation. Quick Requests and
  other unbound sessions never receive ticket-specific plugin behavior.
- OpenCode-assigned worktrees are read from the exact ticket session's live
  location after attach. The shared plugin also observes later native worktree
  creation and passes the exact runtime session ID and native result to the Rust
  bridge. Rust records a path only after verifying the durable ticket/session
  binding and Git repository identity (shared Git common directory or matching
  origin URL). The latest verified worktree replaces the ticket's current path
  and branch; no creator-session field is stored. Shell-created worktrees are not
  automatically attributed.
- Make the ticket-management skill and the guidance needed for its workflows
  globally available as part of this task; this is a required dependency for
  ticket creation and progress flows, not optional follow-up work.
- Use OpenCode and the applicable skills to explain and govern the complete
  creation, clarification, grooming, work, recovery, completion, cancellation,
  and archival flows. The product requirements must document each ticket state,
  its meaning, and the allowed transitions; do not replace those flows with
  undocumented app-side status rules.
- The resulting Markdown ticket is saved under the Workspace's app-data ticket
  directory, outside the repository.
- Ticket-creation interaction and ticket work are distinct: a ticket's creation
  session does not become its work/resume session.
- Tickets remain open to clarification and detail improvements. Use OpenCode and
  the ticket guidance to update the Markdown ticket; do not make draft status a
  barrier to refining its contents.
- A ticket has one OpenCode work session. Work restores that session or creates
  and attaches a replacement if it is missing. Starting a new session replaces
  the ticket binding only after the new terminal attaches, then closes the old
  terminal without deleting its OpenCode conversation. Record the exact session
  ID in ticket YAML front matter. Keep ticket status authoritative in Markdown
  according to the global skill.
- The precise status transition, if any, is performed in OpenCode and persisted
  in the Markdown ticket; the app's Work action does not change status.

### Ticket status model from the reference skill

These names, meanings, and transitions are documented in `rust-main`'s ticket
skill and are the baseline to carry into the global skill. The skill explains
the authoring and execution flows; the application must not invent a competing
lifecycle.

| Status | Meaning | Provisional transitions |
|---|---|---|
| `draft` | Captured ticket still being clarified or groomed; not yet approved for execution. | Remain `draft` while details or material decisions are open; move to `in_progress` when approved work begins; may move to `cancelled`. |
| `in_progress` | Approved ticket work is underway. | Move to `blocked` when an external blocker prevents progress; return from `blocked` when resolved; move back to `draft` when evidence requires renewed grooming/approval; move to `done` after approved work and verification complete; may move to `cancelled`. |
| `blocked` | Work cannot proceed until a recorded blocker is resolved; preserve the last useful state and next step. | Return to `in_progress` when unblocked; may move to `cancelled`. |
| `done` | Approved work and its required validation/verification are complete. | Terminal in the reference workflow; archived after closeout. |
| `cancelled` | Work is abandoned, with reason and disposition of completed/remaining work recorded. | Terminal in the reference workflow; archived after closeout. |

The Markdown file is authoritative for the current status. Any derived list,
badge, or filter in the UI must reflect that file and must not become a second
status store. Whether the app needs a derived index/cache for responsiveness is
an implementation detail, not a second authority.

## Decisions recorded

- **Workspace creation:** link a registered repository directly or create an
  empty local Git repository under
  `<configured repository-library root>/<username>/<workspace-slug>/`; require
  a short description for the empty-repository path. Do not create a clone or
  symlink, separate Workspace home, or OpenCode proposal/session during creation.
  Confirmed in conversation on 2026-11-10.
- **Workspace directory:** do not create a new directory under
  `~/OpenCode Projects` for a Workspace home. Workspace metadata is in SQLite;
  the repository directory is the only Workspace-related directory there.
  Confirmed in conversation.
- **Database reset:** deletion is already complete; no database task is included.
  Prior repository associations are out of scope. Confirmed in conversation.
- **Sessions per ticket:** one OpenCode session per ticket. Starting a new
  session attaches it before replacing the ticket binding, then closes the old
  terminal. The old conversation remains in OpenCode history. Confirmed on
  2026-11-12.
- **Session metadata:** `work_session_id` is the sole ticket binding. Legacy
  `work_session_ids` lists are normalized to that one binding; the application
  does not retain a multi-session list.
- **Worktree association:** one current verified path/branch in front matter;
  latest native OpenCode worktree creation replaces it. Shell-created trees are
  out of automatic attribution. New sessions use it or fall back to the verified
  Workspace checkout.
- **Ticket status:** OpenCode changes status; the Markdown file is authoritative.
  Confirmed in conversation.
- **Ticket storage:** `<app_data_dir>/workspace-tickets/<workspace-slug>/`, outside
  the repository and beside the app database. Confirmed in conversation.
- **Ticket file layout:** `<workspace-ticket-dir>/<slug>.md`, with closed
  tickets under `archived/<slug>.md`, matching `rust-main`. Confirmed in
  conversation.
- **Status on creation:** newly created ticket is `draft`. Confirmed in
  conversation.
- **Creation session:** separate from the ticket's work/resume session.
  Confirmed in conversation.
- **Archived tickets:** separate archive browsing; the default list contains
  non-archived tickets. Confirmed in conversation.
- **Workspace screen:** existing work destinations and tools are scoped under
  a selected ticket; a ticket is required to work. Confirmed in conversation.
- **Ticket selection:** selecting a ticket and explicitly choosing **Work** are
  separate actions; Work opens/resumes the ticket session. Confirmed from the
  original request.

## Feasibility research: ticket assignment in a session

Static source inspection confirms that OpenCode v2.0.27 has an experimental,
session-scoped instruction-entry API. An instruction entry is keyed by the exact
OpenCode session ID, persisted by OpenCode, and rendered into model-visible
context. It can carry the ticket name and absolute Markdown path independently
of the session's working directory. This is durable model context, **not** a
literal system-prompt field.

At the time of this research the application did not use this capability. The
current Rust adapter now installs an entry for the exact ticket session and
refreshes it on Work; replacement sessions receive their own entry. Its HTTP
route is covered by a mock test, but native behavior remains unverified.

This proves a protocol/source mechanism for assigning a ticket without changing
the shared repository cwd. The adapter requests session-scoped read/write access
to the Workspace ticket directory; effective native permissions remain to be
verified. No ticket-content duplication or separate runtime-assignment mechanism
is needed. The API's experimental status remains an implementation risk.

## Next step

The existing task list remains the sole ordered implementation plan; its
requirements and proof above define tasks 1–5. The user explicitly approved
tasks 1–5 on 2026-11-08 and confirmed their native checks. Address any
in-scope failures and retain the recorded frontend-suite limitation. Revisit
Task 6 only after the other tasks are done, as requested by the user.
