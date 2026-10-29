# Quick Requests

The full-list search field and action buttons use shared UI controls with compact
gray styling and the shared whole-CSS-pixel
[spacing weights](../../app/packages/ui-lib/spacing.md) for page and row insets
and control gaps. Filtering behavior is unchanged. Verify appearance on Wayland.

## Navigation

- Quick Requests are the top section of the persistent left navigation, above
  all workspaces and tasks.
- Place **See all Quick Requests** above the recent list.
- Put the compact **See all Quick Requests** icon button on the same row as the
  **Quick Requests** heading. Recent requests use the same compact
  navigation-link styling as workspace entries and have no per-row Delete
  control.
- Render **See all Quick Requests** as an icon-only list-and-arrow button with
  the accessible name **See all Quick Requests**.
- Keep **New work** pinned to the bottom of the navigation while its contents
  scroll. Open its work-type menu upward as an overlay so it does not move the
  pinned button or surrounding navigation content.
- Show Quick Requests created within the last 24 hours in the recent navigation
  list. Older requests remain available in **See all Quick Requests**.
- Highlight the selected Quick Request in the recent list. Opening another
  request moves the highlight even when the list records have not changed;
  selecting a Workspace or deleting the selected request clears it.
- Quick Requests are tasks under the special Quick Requests workspace. Each
  uses the directory chosen or resolved for that request; when no registered repository
  is identified, use the shared folder named **Quick Requests** directly under
  the configured OpenCode Projects root. This is a special shared project
  folder, not a folder in the system temporary directory or an individual
  request home.

## Full-list screen

Use a simple list of all retained Quick Requests, including those older than 24
hours. Each row has a folder-icon **Open** button on the left, the original
prompt as non-clickable text wrapped and clamped to three lines, and an icon-only
Delete action. Activating a row's Delete action enters bulk-delete mode with that
row checked; checkboxes appear on every row and a danger-styled **Delete selected**
button appears above the list. Confirm once before deleting all checked requests.
Cancel exits the mode without deleting anything. Keep spacing compact
throughout the application; avoid large padding around navigation links, list
rows, and controls. Provide a search field above the rows. Search matches the
original prompt using a case-insensitive literal substring; leading and
trailing query whitespace is ignored, and an empty or whitespace-only query
shows every retained request. Keep matching in the full-list view only. When a
non-empty query has no matches, show **No Quick Requests match your search.**
Clearing the field restores all rows. Search does not change or persist records.
After a confirmed deletion, remove the request from both the full list and
recent navigation. If it was selected, keep the full-list destination visible.
This is the full Quick Requests destination, not a
separate generic History destination.

The application lists Quick Request records from its management store. It reads
the displayed original prompt from the dedicated Quick Request prompt record
linked to each request. It does not read OpenCode's private database or copy the
conversation transcript into application storage; only the Quick Request's
original prompt is retained there.

The full-list destination has no Back button. The persistent navigation remains
available for leaving the destination.

```text
┌ Quick Requests ───────────────────────────────────────────────┐
│ Quick Requests                         [New Quick Request]   │
│ [Search Quick Requests…]                                    │
│ [folder] Chord diagram ideas                         [trash]   │
│ [folder] Compare API approaches                      [trash]   │
│ [folder] Review dependency update                    [trash]   │
└───────────────────────────────────────────────────────────────┘
```

The full list is a navigable destination, not a modal or a permanent split pane.
It replaces the current main-area destination without resizing the fixed app
shell. The persistent navigation returns to the list without closing the terminal.

## Opening a Quick Request

- Selecting a Quick Request opens its own page in the main work area. Keep the
  left navigation and app shell visible. The terminal fills all available height
  in that work area, using the workspace terminal's sizing behavior. Keep the
  window chrome and left navigation visible.
- The Quick Request page contains the terminal only:
  no workspace/task toolbar, **+ Task**, session tabs, prompt/header, or
  page-level terminal controls. Show zero tabs on this page.
- Navigation returns to the full Quick Requests list without closing the terminal or
  stopping its process. The Quick Request terminal page can be reopened.
- The recent navigation list is limited to the last 24 hours. Older requests
  remain reachable through the full Quick Requests list.

The full Quick Requests list does not enable the separate generic History menu;
regular work history remains deferred.

## New Quick Request action

The navigation **New work** dropdown offers **Workspace**, **Task** when a
regular workspace is selected, and **Quick Request**. The full-list page also
has a **New Quick Request** action that starts this same flow directly.

Choose **Quick Request** from the dropdown. Quick Request
creation resolves a working directory from the user's explicit choice or the
app's registered repository catalog; the user confirms the directory.
The initial modal shows the default path in an editable field above the prompt,
with a folder picker. A typed or chosen existing directory applies only to that
request and is the only directory permitted in the proposal. When the default is
unchanged, the proposal may choose a matching enabled repository. Review allows
typing a path, choosing a folder, or resetting to the shared default.
If no registered repository is identified, use the shared **Quick Requests**
folder under the configured OpenCode Projects root. This step does not rewrite
or reinterpret the user's prompt. Starting the request
opens its terminal page and sends the original prompt. Use
**prompt** for the user's text, not “request” as a generic product type. See
[New Work](screen-new-work.md).

Quick Request rows have Open and Delete icon actions. Confirm bulk deletion. This
removes the request, prompt, and session association from the application and
closes its attached terminal; the OpenCode conversation remains in OpenCode.
Do not show dismiss, promote, retry, or other per-row buttons.
