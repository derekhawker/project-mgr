# New Work

## Purpose

**New work** opens a compact modal over the current destination with two choices:
**Workspace** and **Quick Request**. Workspace is the sole regular work record;
there is no Task creation or separate name-first Workspace flow.

The dialog is comfortably sized and padded. When its contents exceed the
available height, only the dialog body scrolls; its action footer stays visible
and anchored at the bottom.

The prompt-capture modal is compact and clearly labels the selected flow. The
proposal/review modal grows only after Continue, when it must show extracted
details and repository choices. Workspace review has an optional editable
starting prompt; a blank value never skips required session setup.

The modal does not reset the current destination or terminal. Cancel returns to
the unchanged destination.

## Workspace flow

The first deliverable supports one New-work outcome: **create a workspace**.
The flow has two prompts:

1. The user enters the **original prompt** describing the workspace.
2. After the prompt is interpreted and confirmed, the app creates a workspace
   and starts the workspace's session or sessions.

### 1. Capture the original prompt

Show a compact modal titled **New Workspace** or **New Quick Request**. Label the
field **Original prompt** and explain what that prompt will start. Preserve the
original prompt exactly as entered.

In the multiline Original prompt field, **Enter** continues the form and
**Shift+Enter** inserts a newline. Enter during IME composition does not submit.

### 2. Review the interpretation

The first interaction is an internal OpenCode proposal request. It does not use
an interactive terminal. This is the one exception to the normal terminal rule:
the proposal request is not a user session, does not create a terminal tab, and
does not change product data.

Rust validates the proposal before showing it for confirmation. Workspace review
uses a simple vertical form instead of a card grid. It shows:

- An editable workspace name.
- The full workspace directory path that confirmation will create.
- The original prompt in a read-only field.
- Relevant repository locations, if any, as a compact list of repository names
  and source paths.
- One editable starting-prompt field, prefilled with the revised prompt returned
  by OpenCode, not the original prompt the user entered.

Do not show a separate proposed-prompt section. OpenCode's revised text is the
starting prompt, shown once in the editable starting-prompt field. The user
can go back and submit a new original prompt to obtain a fresh interpretation.
The workspace directory remains the exact reviewed path shown in the form;
editing the display name does not silently move the planned directory.

The first-deliverable proposal has this conceptual shape:

```json
{
  "schemaVersion": 1,
  "workType": "workspace",
  "workspace": { "id": null, "name": "...", "intent": "..." },
  "repositories": [],
  "startingPrompt": "...",
  "effects": ["Create workspace and start its OpenCode session"]
}
```

Malformed proposals or invalid repository references are rejected before
confirmation. No workspace is created by the proposal request.
Workspace setup uses the repository's reviewed committed Git state. A dirty source
checkout is allowed: tracked, untracked, and ignored local files stay in the
original checkout and are not copied into the managed base clone, Workspace
worktree, or Workspace symlink. Rust still revalidates repository identity, the
reviewed commits, default branch, remote, and committed submodule metadata.
Default branch resolution prefers a valid `origin/HEAD`, then a local `main` or
`master` branch, then the currently checked-out local branch. This supports
repositories without remotes. If no branch can be determined, show a clear error
explaining that the repository needs a configured `origin/HEAD` or a local
branch.

Enabled repositories from the Directories page are additional context to every
New-work proposal; disabled repositories are absent from proposal input and
cannot be selected as working directories.
Users do not have to manually attach a repository before naming it in a
Workspace prompt. The proposal maps mentioned repositories to verified catalog
identities; the review shows the selected repository names and source locations
as a compact list, and confirmation attaches them to the new Workspace. Do not
expand this list with proposal reasons, clone destinations, or submodule details.

### 3. Confirm and start the workspace session

Confirmation performs one user-visible flow:

1. Rust creates the workspace and its home directories.
2. Rust clones and validates the confirmed repositories, including recursive
   submodules.
3. Rust creates and records one Workspace session for zero repositories, one
   worker for one repository, or an outside-repository orchestrator plus one
   worker per repository for multiple repositories.
4. The app selects the new workspace and opens all of its interactive terminal
   tabs.
5. A nonblank starting prompt goes to the zero-repository Workspace session,
   single-repository worker, or multi-repository orchestrator, respectively.
   Workers always start empty.

Keep a visible, ordered progress list in the New-work dialog while this runs.
Place it immediately after the active prompt field: below the original prompt
during interpretation, then below the revised starting prompt during Workspace
review and setup.

- **Interpret request** — success before the proposal is shown, or failed with
  the error if proposal generation fails.
- **Create workspace** — success when the Workspace record is created.
- **Clone _repository name_** — one in-progress/success/failed row per selected
  repository, with its source location shown. Never display an internal
  repository ID in progress labels or failure details. A failed row can expand
  to show the Git/setup error detail.
- **Write workspace instructions** — success or failed when applicable.
- **Start workspace session(s) and terminal(s)** — success or failed, with one
  terminal for zero/one repository and one per repository for multiple repos.
- **Submit starting prompt** — shown only for zero/one-repository workspaces;
  if the optional field is blank, mark it skipped rather than failing setup.
- **Workspace create** — final success only when required setup and session
  startup succeeded; otherwise show **Workspace create — failed** and the
  individual failed step details. Do not present a partially provisioned
  workspace as ready.

The list is transient UI progress, not a new log file or database record. Show
captured error detail, not prompt text or unrestricted process output. Keep the
list in the dialog only; do not leave it on the Workspace page after the
terminal tabs.

The user does not need a second manual start action for zero/one repository.
For multiple repositories, each empty terminal is ready for a user-directed
prompt; do not fan out the original or generated prompt. Navigating to that
workspace later opens or restores all of its exact tracked sessions.

If repository setup or session startup fails after the Workspace is created,
keep the durable Workspace available, leave the failed step and its detail in
the visible review pane in the New-work dialog, and offer the applicable retry
action there. Selecting the durable Workspace must not hide the only failure
details while the modal remains open. Do not leave the progress list on the
selected Workspace page after its tabs.

## Legacy Task records

Task is no longer a creation option or product-level work type. Existing Task records remain available during the staged compatibility refactor, but new work starts as a Workspace or Quick Request. Their eventual archive and conversion are specified in `../workspace-refactor-target.md`.

## Example

```text
Your prompt
“new project to manage movie preferences using a simple document”

Proposed workspace: Movie Preferences
Repositories: None

Starting prompt (editable)
[Create and maintain a simple document of movie names and thoughts]

[Back]                                      [Create workspace]
```

After confirmation, the new Workspace is selected. A Workspace with two
repositories opens an outside-repository Orchestrator and two repo-rooted worker
terminals. Workers start empty; a nonblank starting prompt goes only to the
Orchestrator.

## Quick Request flow

This is a two-step flow:

1. **Resolve the directory.** The user chooses **Quick Request** from the New
   navigation dropdown and
   enters the original prompt. The internal proposal step's sole purpose is to
    resolve a working directory using the enabled repository list as its initial
    verified context. It may select only an enabled repository; Rust validates
    the selected repository and exact path. The user can correct the proposed
    selection using another enabled repository. If no repository is identified, the proposal
   uses the shared default Quick Request directory. This step does not create a
   Quick Request, generate a replacement prompt, or create a terminal.
2. **Confirm and start.** The user reviews or corrects the resolved directory
   and confirms it.
   Rust creates the Quick Request under the special Quick Requests workspace,
    creates and records its exact OpenCode session and working directory, opens
    the Quick Request page with the terminal filling the available main work
    area, and sends the original prompt unchanged.

There is no workspace choice or editable starting-prompt step in this flow. The
terminal destination and navigation are specified in
[Quick Requests](screen-quick-requests.md).
