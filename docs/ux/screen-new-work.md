# New Work

## Purpose

**New** opens a compact modal over the current destination and offers work-type
choices for a workspace, a task when workspace context is available, or a Quick
Request. Choosing a type starts that flow; there is no separate name-first
**New workspace** flow.

The dialog is comfortably sized and padded. When its contents exceed the
available height, only the dialog body scrolls; its action footer stays visible
and anchored at the bottom.

The prompt-capture modal is compact and clearly labels the selected work type
in both its title and prompt instruction. The proposal/review modal grows only
after Continue, when it must show extracted details and repository choices.
Workspace review has an optional editable starting prompt that is sent according to the
Workspace repository-count rules when nonblank. Task review has an optional editable revised
prompt for reference only; it is not sent to Task sessions or persisted. The
review title repeats the work type so the action being confirmed is never
ambiguous.

The modal does not reset the selected workspace, task, or terminal. Cancel
returns to the unchanged destination.

## Workspace flow

The first deliverable supports one New-work outcome: **create a workspace**.
The flow has two prompts:

1. The user enters the **original prompt** describing the workspace.
2. After the prompt is interpreted and confirmed, the app creates a workspace
   and starts the workspace's session or sessions.

### 1. Capture the original prompt

Show a compact modal titled **New Workspace**, **New Task**, or **New Quick
Request** as appropriate. Label the field **Original prompt** and explain what
that prompt will start. Preserve the original prompt exactly as entered. For a
Task, pass the Workspace selected in the separate Workspace selector as context;
do not prepend Workspace text into the prompt.

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
When validating repositories for workspace setup, Git-ignored files do not count
as uncommitted changes; tracked changes and non-ignored untracked files still do.
Default branch resolution prefers `origin/HEAD`, then falls back to `origin/main`
or `origin/master` when the matching local branch also exists.

Enabled repositories from the Directories page are additional context to every
New-work proposal; disabled repositories are absent from proposal input and
cannot be selected as working directories.
Users do not have to manually attach a repository before naming it in a
workspace or task prompt. The proposal maps mentioned repositories to verified
catalog identities; the review shows the selected repository names and source
locations as a compact list, and confirmation attaches them to the new workspace
or task. Do not expand this list with proposal reasons, clone destinations, or
submodule details.

### 3. Confirm and start the workspace session

Confirmation performs one user-visible flow:

1. Rust creates the workspace and its home directories.
2. Rust clones and validates the confirmed repositories, including recursive
   submodules.
3. Rust creates and records one session for zero/one repository, or one session
   per repository clone for multiple repositories.
4. The app selects the new workspace and opens all of its interactive terminal
   tabs.
5. For zero/one selected repository, Rust sends the confirmed starting prompt
   through the workspace session when it is nonblank. If the user clears it,
   setup succeeds without sending a prompt. For multiple repositories, Rust
   opens one empty session per clone and sends no prompt automatically.

Keep a visible, ordered progress list in the New-work dialog while this runs.
Place it immediately after the active prompt field: below the original prompt
during interpretation, then below the revised starting prompt during Workspace
review and setup.

- **Interpret request** — success before the proposal is shown, or failed with
  the error if proposal generation fails.
- **Create workspace** — success when the Workspace record is created.
- **Clone _repository name_** — one in-progress/success/failed row per selected
  repository. A failed row can expand to show the Git/setup error detail.
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
the New-work dialog, and offer the applicable retry action there. Do not leave
the progress list on the selected Workspace page after its tabs.

## Task flow

Task creation starts with a prompt scoped to a selected active Workspace. The
prompt is transient input for extracting and reviewing task metadata; it is not
a starting prompt for any repo session.

The user can start this flow in either of two ways:

- Select **Task** from the navigation's **New work** dropdown.
- Right-click a Workspace in navigation and choose **New Task**.

Both entry points show a required **Workspace** selector in the Task prompt
form. The navigation dropdown starts with no Workspace selected. The Workspace
context menu preselects the Workspace that was clicked, but the user can change
the selection before continuing. Only active regular Workspaces are available.

1. The user selects a Workspace and enters the original task prompt.
2. The internal proposal interprets it using the selected Workspace's repository
   context; the selected Workspace is passed separately from the prompt.
3. The user reviews the proposed Task name and intent, selected Workspace and
   Task home location, original prompt, repository selection, and expected setup.
   The Task name and intent can be edited. The original prompt is read-only.
   An optional revised prompt can be edited or left blank; it is only a
   reference for the user and is not submitted or saved by the application.
4. After confirmation, Rust creates task worktrees and one empty OpenCode
   session per selected repository, each rooted at its own worktree, then opens
   their interactive terminals. No Task prompt is sent automatically.

If setup is incomplete, keep the Task record, show itemized results, and offer
**Retry repository setup**. The retry uses the same confirmed repository set;
it does not create another Task or change its selection.

The task tracks each session with its exact repository and directory. Navigating
to the task restores its tracked repo sessions. The user coordinates work
between terminals and enters prompts manually. A task with no selected
repositories has no repo session to open.

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

After confirmation, the new workspace is selected. A workspace with two
repositories opens two repo-rooted OpenCode terminals, both empty; no prompt is
submitted automatically.

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
