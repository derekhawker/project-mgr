# Quick Requests

## Navigation

- Quick Requests appear at the top of the persistent left navigation.
- Place **See all Quick Requests** above the recent list.
- Always show requests from the last 24 hours in the recent list. Keep the
  section secondary to the workspace/task workbench in the main area.
- Quick Requests are tasks under the special Quick Requests workspace and use
  the shared request context defined by the application workflow.

## Full-list screen

Use a simple list of all Quick Requests that are currently available in the
active presentation. Rows show the request, status, and age; request-specific
actions such as dismiss or promote remain contextual. Do not add a history view
in this slice.

```text
┌ Quick Requests ───────────────────────────────────────────────┐
│ Quick Requests · 3                          [Search] [New]    │
│ Chord diagram ideas       Running          32 min ago         │
│ Compare API approaches    Waiting for input 3 hr ago         │
│ Review dependency update  Ready for review 18 hr ago          │
└───────────────────────────────────────────────────────────────┘
```

The full list is a navigable view, not a modal or a permanent split pane. It
slides in as a peer view, replacing the currently selected main view without
resizing it. Include **Back to Quick Requests** when viewing a request terminal.
Returning to the list switches views; it does not close the terminal tab.

## Opening a request

- Selecting a request opens its interactive terminal at the full available size.
- Terminal controls and lifecycle are owned by the terminal. Closing its tab
  stops its process and closes the tab.
- Switching back to the list does not close the tab or stop the process.
- Keep running and input-waiting requests visible even after the 24-hour point;
  stable expired or dismissed requests are not exposed through a history screen
  for now.

History is deferred; any History menu option remains disabled.

## Shared creation

The single **New** action handles Quick Request creation as well as workspace
and task creation. The Quick Request route must not require a workspace choice;
it uses the shared request context. See [New Work](screen-new-work.md) for the
prompt/proposal interaction.
