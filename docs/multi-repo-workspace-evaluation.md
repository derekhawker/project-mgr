# Multiple-repository workspace evaluation

## Goal

Verify that one project-manager Workspace can contain two independent Git
repositories and opens one empty OpenCode terminal per repository, and that one
Task can work across both at once. Use the manual OpenCode evaluation below to
verify that a separately created OpenCode session for each repository uses its
task worktree as its working directory and can
discover that repository's local `AGENTS.md` and skill.

This is an end-to-end verification deliverable. Existing code and lower-level
tests cover pieces of this behavior; this evaluation must prove the complete
production path and expose any missing behavior. Do not merge the repositories
into one Git root or assume that repository-local guidance is automatically
available to an agent whose working directory is outside that repository.

## Fixture

Create two separate GitHub repositories and clone them as sibling repositories
inside one project-manager Workspace:

```text
<workspace-home>/
├── AGENTS.md                         # workspace orchestration rules
├── repos/
│   ├── <repo-a>/                     # independent Git root
│   │   ├── AGENTS.md                 # ends responses with `ribbit`
│   │   ├── my-file-a
│   │   └── .opencode/skills/repo-a-proof/SKILL.md
│   └── <repo-b>/                     # independent Git root
│       ├── AGENTS.md                 # ends responses with `*grumble(`
│       ├── my-file-b
│       └── .opencode/skills/repo-b-proof/SKILL.md
└── tasks/
    └── <evaluation-task>/worktrees/
        ├── <repo-a>/                 # task worktree for repo A
        └── <repo-b>/                 # task worktree for repo B
```

Each remote starts with one simple content file: `my-file-a` in Repo A and
`my-file-b` in Repo B. The `AGENTS.md` and skill files are additional evaluation
assets. Keep the Git roots separate and preserve each repo's history.

The GitHub owner, repository names, and visibility remain to be chosen. Do not
create or publish repositories until those are confirmed.

## Instruction and skill contract

The Workspace-root `AGENTS.md` explains that the child repositories are
independent, gives their paths, and says each Task has a separate OpenCode
session rooted in each selected repository's task worktree. Keep each change in
the matching repo session. Before editing, the user asks that session to inspect
its repository's `AGENTS.md` and load its repository skill. Cross-repository
coordination is done by the user across the separate sessions, not by a parent
agent.

Repo A's instruction requires its repo session response to end with the
exact suffix `ribbit`. Repo B's instruction requires its repo session
response to end with the exact suffix `*grumble(`, including the opening
parenthesis. These directives are deliberately different; keep each directive
scoped to its own repo session.

Use distinct skill IDs (`repo-a-proof` and `repo-b-proof`). Each skill should
provide a small, unmistakable marker in the session report (`repo-a-skill-loaded`
or `repo-b-skill-loaded`) so the evaluation can verify that the skill was
actually loaded, not merely found or mentioned.

**Discovery is an explicit test.** OpenCode V2 searches for project skills from
the session's working directory toward the project root; it does not search
down into sibling repositories. Verify each repo session was created with the
corresponding task worktree as its actual session directory.

## Evaluation scenario

Open the two task-owned OpenCode sessions, one per repo worktree. The user sends
an explicit small change request to each session; session creation itself sends
no prompt. The exact file edits can be agreed when the fixture is created; they
must be deterministic and independently verifiable.

1. Rust has created and recorded one empty session per selected repository, each
   with its own task worktree as the OpenCode directory.
2. In Repo A's session, the user requests the assigned change. It discovers
   Repo A's `AGENTS.md`, loads `repo-a-proof`, makes only the assigned change to
   `my-file-a`, reports `repo-a-skill-loaded`, and ends its response with
   `ribbit`.
3. In Repo B's session, the user requests the assigned change. It discovers
   Repo B's `AGENTS.md`, loads `repo-b-proof`, makes only the assigned change to
   `my-file-b`, reports `repo-b-skill-loaded`, and ends its response with
   `*grumble(`.
4. Verify the two task worktrees remain independent Git roots and the changes
   are isolated to the intended file in each repository.

The evaluation passes only if each session uses its own task worktree,
instruction, and skill, and neither changes the other repository.

## Project-manager workflow

In the application, validate the corresponding production path:

1. Scan only the two user-selected repository directories, one at a time, so
   only those repositories are discovered for this evaluation:
   `<fixture-root>/repo-a` and `<fixture-root>/repo-b`. Wait for each async scan
   to finish and verify both entries appear in the loaded catalog. The current
   catalog is additional context for each New-work proposal; it is not a
   requirement to attach repositories before writing the workspace prompt.
   This is catalog discovery, not workspace attachment; do not scan a broader
   parent tree.
2. Choose **New work → Workspace** and describe the intent naturally, for
   example: “I want to work on a unified project consisting of Repo A and Repo
   B.” The proposal receives the currently loaded repository catalog as
   additional context and should resolve those names to the catalog repository
   IDs.
3. Review the generated workspace proposal. Confirm that it names the intended
   workspace and proposes both repositories, with reasons. Correct the prompt
   and regenerate if either repository is missing or wrong; do not manually
   attach repositories as a substitute for testing proposal selection.
4. Confirm the proposal. Verify the app creates the Workspace, attaches both
   confirmed repositories, and opens two tabs—one session rooted at each clone.
   Verify neither the original nor generated prompt is submitted automatically
   to this multi-repository workspace.
5. Add the Workspace-root orchestration `AGENTS.md` described below to the
   created workspace home before creating the evaluation Task.
6. From that Workspace, create a Task whose confirmed repository selection
   contains both IDs. Verify setup creates one task-owned worktree per
   repository under that task's `worktrees/` directory, each bound to the
   correct repo, branch, and path.
7. Open the Task's two interactive OpenCode sessions from the Task view. Verify
   each session directory matches its respective ready task worktree and that
   both worktrees remain independent Git roots. Send no prompt automatically;
   enter the test request manually in each terminal.

## Test layers and acceptance

- **Rust integration:** use two real temporary Git repositories and an isolated
  SQLite store to exercise independent Workspace clones, task selection,
  distinct worktrees, per-repository sessions, and persisted context through
  production services and command boundaries.
- **Frontend contract:** verify the production UI sends both confirmed
  repository IDs and handles the serialized per-repository results and errors.
- **OpenCode evaluation:** run the manual scenario below using the two
  repo-rooted task sessions in the installed OpenCode V2 CLI. Record each
  session's actual directory, loaded instruction/skill marker, response suffix,
  and changed files. Do not infer skill discovery from an `AGENTS.md` success.
- **Manual Wayland acceptance:** attach both repositories, create and open the
  multi-repository Workspace and Task. Verify two workspace tabs, empty
  workspace sessions, two task tabs, and exact clone/worktree directories; then
  run the OpenCode instruction/skill-discovery evaluation below.

## Manual findings (2026-10-15)

- **Failed:** creating a two-repository Workspace opened only one OpenCode
  terminal. **Expected:** one tab/session rooted at each repository clone.
- **Failed:** the reviewed prompt was submitted automatically for that
  multi-repository Workspace. **Expected:** both repository sessions open empty;
  the user chooses which session receives a prompt.
- **Failed:** the setup progress list remained visible on the selected Workspace
  page after the terminal tabs. **Expected:** progress is confined to the
  New-work dialog and is not left on the workspace page.
- **Remove:** the fullscreen button/control from every screen and state.
- **Missing:** after Ctrl+D exits a TUI, the tracked tab needs a **Restart
  terminal** action that reopens the same OpenCode session and directory without
  creating a new session or sending a prompt.

These items remain acceptance failures until implemented and rechecked; the
manual evaluation must not be marked passed based on the current behavior.

Existing coverage is partial. `i07_setup_fixtures.rs` exercises one task with
two independent real Git repositories through Workspace binding, confirmed
selection, worktree registration, and task-context resolution.
`shell.test.js` checks that both selected repository IDs cross the frontend
task-creation boundary.
The production vertical-flow suite does not yet carry this through the actual
Tauri command/UI flow. Earlier tests showed that subagents run with the parent's
session directory even when told to inspect an absolute repo path. That is not
the selected design: Rust will create ordinary Task-owned OpenCode sessions
with each repository worktree passed as `location.directory`. The app's existing
session-creation contract already accepts an explicit directory; the remaining
manual gate is to verify each repo session's persisted/runtime directory and
local skill discovery.

## Fixture details to choose before manual acceptance

- GitHub owner, repository names, and public/private visibility.
- Exact starting contents for `my-file-a` and `my-file-b`.
- Exact deterministic file edits used in the evaluation prompt.

## Manual OpenCode instruction and skill-discovery evaluation

Run this after the natural-language Workspace proposal has attached both
repositories and the multi-repository Task has created its two independent task
worktrees. Commit the
following tracked evaluation assets in each source repository before creating
the task, so they are present in the task worktrees:

- Repo A: `AGENTS.md` requires its session response to end with the exact
  suffix `ribbit`. `.opencode/skills/repo-a-proof/SKILL.md` has a clear
  description and instructs the session to add `repo-a-skill-loaded` to
  `my-file-a` and include the same marker in its report.
- Repo B: `AGENTS.md` requires its session response to end with the exact
  suffix `*grumble(`. `.opencode/skills/repo-b-proof/SKILL.md` has a clear
  description and instructs the session to add `repo-b-skill-loaded` to
  `my-file-b` and include the same marker in its report.
- Workspace home: `AGENTS.md` says the repositories are separate Git roots;
   repo changes must remain in separate Task sessions, one per repository. Each
   session must verify its directory, read the local `AGENTS.md`, explicitly
   load its local skill, and only edit its assigned file. The user coordinates
   across the sessions and sends test prompts manually.

Use unique skill IDs and descriptions. Do not install or configure these skills
globally or list them in a Workspace-level `skills` config: the purpose is to
prove repository-local discovery from each task worktree.

### Steps

1. Open the Task's Repo A session and Repo B session from the project-manager
   UI. Confirm each session's persisted and actual OpenCode directory matches
   its own task worktree. Session creation must not send a prompt.
2. In each terminal, manually enter only that repository's deterministic test
   request. Ask the session to report `pwd` before editing.
3. In each session, require an explicit skill-tool load by exact ID
   (`repo-a-proof` / `repo-b-proof`). Do not accept a skill merely appearing in
   a discovered-skills list or being mentioned without a successful load.
4. Each session reads its own `AGENTS.md`, then makes the one-file change
   required by its skill. It reports the skill marker and ends with its suffix.
5. Inspect each task worktree's Git diff and status. Repo A must have only the
   intended `my-file-a` change; Repo B only the intended `my-file-b` change.
   Verify both are still separate Git roots and each worktree belongs to the
   expected source repository.

### Evidence and pass criteria

Record both task session IDs, each session's persisted and actual working
directory, whether its exact skill-tool load succeeded, the unique marker in its
report and file, the response suffix, and the per-repo Git diff. A pass requires
all of the following:

- Each session was created with its own task worktree as the effective OpenCode
  working directory. Merely being told to stay in a repo, or shelling into a
  path while the OpenCode session remains rooted elsewhere, is not sufficient.
- Each session loaded the skill from its own repository by exact ID, and the
  matching marker appears in its report and assigned file.
- Each session followed only its own suffix rule and made no change in the other
  repository.

If a session does not use its requested task-worktree directory or cannot load
the local skill, record the scenario as **failed/blocked**. Do not work around
the result by copying skills into the Workspace, making them global, or editing
the repository from a different session; that would mask the discovery question
this evaluation is intended to answer.
