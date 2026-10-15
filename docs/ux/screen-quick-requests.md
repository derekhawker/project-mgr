# Quick Requests

## Navigation

- Quick Requests are the top section of the persistent left navigation, above
  all workspaces and tasks.
- Place **See all Quick Requests** above the recent list.
- Always show Quick Requests from the last 24 hours in the recent list. Keep the
  section secondary to the workspace/task workbench in the main area.
- Quick Requests are tasks under the special Quick Requests workspace and use
  the shared Quick Request context defined by the application workflow.

## Full-list screen

Use a simple list of all Quick Requests that are currently available in the
active presentation. Rows show the prompt, status, and age; Quick Request-specific
actions such as dismiss or promote remain contextual. Do not add a history destination
in this slice.

```text
┌ Quick Requests ───────────────────────────────────────────────┐
│ Quick Requests · 3                          [Search] [New]    │
│ Chord diagram ideas       Running          32 min ago         │
│ Compare API approaches    Waiting for input 3 hr ago         │
│ Review dependency update  Ready for review 18 hr ago          │
└───────────────────────────────────────────────────────────────┘
```

The full list is a navigable destination, not a modal or a permanent split pane.
It slides in as a peer destination, replacing the currently selected main-area
content without resizing it. Include **Back to Quick Requests** when using a Quick Request
terminal.
Returning to the list changes destinations; it does not close the terminal tab.

## Opening a Quick Request

- Selecting a Quick Request opens its interactive terminal at the full available
  size. OpenCode generation and all follow-up interaction happen in that
  terminal so the user can watch progress and make changes.
- Terminal controls and lifecycle are owned by the terminal. Closing its tab
  stops its process and closes the tab.
- Switching back to the list does not close the tab or stop the process.
- Keep running and input-waiting Quick Requests visible even after the 24-hour point;
  stable expired or dismissed requests are not exposed through a history screen
  for now.

History is deferred; any History menu option remains disabled.

## Shared creation

The single **New** action will handle Quick Request creation as well as
workspace and task creation. Quick Request creation is deferred until after the
workspace/task deliverable. It will use the same prompt/proposal interaction and
the special Quick Requests workspace context; it will not require a workspace
choice. Use **prompt** for the user's text, not “request” as a generic product
type. See [New Work](screen-new-work.md).
