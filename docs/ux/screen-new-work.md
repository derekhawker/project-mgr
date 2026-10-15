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
after Continue, when it must show a reworded starting prompt and supporting
details. The review title repeats the work type so the action being confirmed
is never ambiguous.

The modal does not reset the selected workspace, task, or terminal. Cancel
returns to the unchanged destination.

## Workspace flow

The first deliverable supports one New-work outcome: **create a workspace**.
The flow has two prompts:

1. The user enters the **original prompt** describing the workspace.
2. After the prompt is interpreted and confirmed, the app creates a workspace
   and starts a new OpenCode session with the returned **starting prompt**.

### 1. Capture the original prompt

Show a compact modal titled **New Workspace**, **New Task**, or **New Quick
Request** as appropriate. Label the field **Original prompt** and explain what
that prompt will start. Preserve the original prompt exactly as entered. When
**Task** is chosen from the navigation's **New work** dropdown
while a regular workspace is selected, pass that workspace as separate context;
do not prepend workspace text into the prompt.

### 2. Review the interpretation

The first interaction is an internal OpenCode proposal request. It does not use
an interactive terminal. This is the one exception to the normal terminal rule:
the proposal request is not a user session, does not create a terminal tab, and
does not change product data.

Rust validates the proposal before showing it for confirmation. The review
shows:

- The original prompt, unchanged and read-only.
- The proposed workspace name, description, and intent.
- Relevant repository context, if any.
- The proposed starting prompt for the workspace's first OpenCode session.
- The expected effects of confirmation.

Only the starting prompt is editable. The user can go back and submit a new
original prompt to obtain a fresh interpretation.

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

### 3. Confirm and start the workspace session

Confirmation performs one user-visible flow:

1. Rust creates the workspace and its home directories.
2. Rust creates a new OpenCode session in the workspace context.
3. Rust records the exact session on the workspace.
4. The app selects the new workspace and opens its interactive terminal.
5. Rust sends the confirmed starting prompt through that session.

The user does not need a second manual start action. The workspace is usable as
soon as its terminal opens. Navigating to that workspace later always opens or
restores its exact tracked session; it never chooses an unrelated newest
session.

If workspace creation or session startup fails, show the failure beside the
relevant action and do not claim success. Do not leave an empty owner from a
failed confirmation.

## Task flow

Task creation also starts with a prompt and uses the same two-prompt shape,
scoped to the selected workspace:

1. The user selects **Task** from the navigation's **New work** dropdown and
   enters the original task prompt.
2. The internal proposal interprets it using the workspace's repository context.
3. The user reviews the proposed task, repository context, and starting prompt.
4. After confirmation, Rust creates the task, records its exact repository
   selection, creates its OpenCode session, and opens its interactive terminal.

The task tracks its exact session. Navigating to the task restores that session
through the normal interactive terminal flow.

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

After confirmation, the new workspace is selected and its interactive OpenCode
terminal opens automatically with the starting prompt.

## Quick Request flow

This is a two-step flow:

1. **Resolve the directory.** The user chooses **Quick Request** from the New
   navigation dropdown and
   enters the original prompt. The internal proposal step's sole purpose is to
   resolve a working directory. It may select only a repository from the
   application's registered repository catalog; Rust validates the selected
   repository and exact path. The user can correct the proposed selection using
   another registered repository. If no repository is identified, the proposal
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
