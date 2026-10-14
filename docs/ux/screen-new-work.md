# New Work

## Purpose

One **New** action handles regular workspace/task creation and Quick Requests.
The user describes intent first; the app does not ask them to choose a product
object before understanding the request.

## Flow

### 1. Capture intent

Show one prompt field and Continue. Preserve the text exactly as entered.

### 2. Review the structured proposal

The first LLM request returns structured data for this screen. Keep the original
request visible and show the proposed interpretation and consequences separately.
The proposal may include:

- Whether this is a new workspace, a task in an existing workspace, or a Quick
  Request.
- Proposed workspace/task name and concise intent.
- Existing workspace match, when applicable.
- Repositories matched from the prompt; zero repositories is valid.
- Jira issues to read or a proposed issue to create when relevant. Creating an
  issue must be apparent to the user; a branch must not be created without its
  required Jira ticket.
- An editable starting prompt for the new OpenCode session. It is prepared but
  not submitted.
- The expected effects of confirmation.

Example for an existing project:

```text
Original request
“Review code comments in agentic-frontend”

Proposed: Task in agentic-frontend
Repository: agentic-frontend
Jira: [matched issue or proposed action, if applicable]

Starting prompt (editable, not submitted)
[Proposed prompt using the matched project context]

[Back]                                      [Create task]
```

Example for a project without a repository:

```text
Original request
“New project to keep track of movie recommendations”

Proposed: New workspace “Movie recommendations”
Repositories: None

Starting prompt (editable, not submitted)
[Proposed workspace-session prompt]

[Back]                                 [Create workspace]
```

Do not paraphrase away the user's original intent or silently commit inferred
choices. Let the user correct the destination and proposed context before
confirming.

## Creation behavior

- Workspace and task creation are prompt-initialized; neither is created as an
  empty shell.
- Creation and required initialization succeed together or leave no workspace or
  task record behind.
- On success, open the new owner's interactive OpenCode terminal with its
  starting template available but unsent.
- Quick Request uses the same New entry point. Its specific creation/list
  behavior is covered in [Quick Requests](screen-quick-requests.md).
