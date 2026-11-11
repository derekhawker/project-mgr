# New Work

## Purpose

**New work** opens a compact modal over the current destination with two choices:
**Workspace** and **Quick Request**. Workspace is the sole regular work record;
there is no Task creation or separate name-first Workspace flow.
The New work disclosure keeps its visible label and uses the shared decorative
SVG chevron instead of a native text marker. The menu opens upward from the
bottom of navigation: its chevron points up when closed and rotates down when
open. Opening and closing animate the rotation unless reduced motion is requested.
Direction, placement, and animation belong to the shared ActionMenu component.
Its choices use the library's flat, left-aligned ActionMenuItem rows on the same
purple surface as Tools, without ordinary button borders or rounding. Native
Tab navigation and Enter/Space activation remain available.

The dialog uses the shared [spacing weights](../../app/packages/ui-lib/spacing.md)
for its frame, fields, and review groups. It sizes to its content with compact,
consistent padding; it never
stretches to fill the window or leaves a blank panel below its actions. When its
contents exceed the available height, only the dialog body scrolls. Its title
header and action footer stay visible, including in short windows. Long prompt
text and paths wrap rather than widening the dialog.

The prompt-capture modal is compact and clearly labels the selected flow. The
proposal/review modal uses a wider content-fitting layout only after Continue,
when it must show extracted details and repository choices. Neither step has a
fixed height. Workspace review has an optional editable
starting prompt; a blank value never skips required session setup.

The modal does not reset the current destination or terminal. Cancel returns to
the unchanged destination. Clicking outside does not dismiss it; use Cancel or
Escape, which runs the same cleanup before closing. A labelled close icon in the
header requests that same cancellation; failed cleanup keeps the dialog open.
Opening focuses Original prompt. Review focuses Workspace name or the working
directory selector; Back returns focus to Original prompt and resets body
scroll. Tab and Shift+Tab stay within the dialog's visible enabled controls.
Closing returns focus to the New work menu trigger.

Keep the surrounding workspace screen gray. The New-work popup may use a concentrated
C64-inspired blue/lavender surface, with readable light labels, dark text fields,
and a distinct primary action. Back and Cancel remain secondary.
The modal animates on opening unless the user prefers reduced motion.
The shared Modal supplies the frame and keyboard interactions; the existing
native dialog controller still owns cancellation and cleanup. Verify
the combined appearance, focus, and native behavior manually on Wayland.

## Workspace flow

Workspace creation is a direct form. It does not capture a prompt, create an
OpenCode proposal session, or start a work session. The modal offers exactly two
paths through one **Repository** selector:

- **A registered repository:** options come from the Repositories view. Selecting
  one suggests an editable **Workspace title** by splitting its name at hyphens,
  underscores, and lowercase-to-uppercase boundaries, then capitalizing words.
  For example, `my_repoName` becomes `My Repo Name`. The Workspace links directly
to that registered repository; it does not clone it.
- **Create an empty workspace:** show an editable **Workspace title** and a
  required **Short description**. Rust creates and initializes a local Git
  repository at `<configured repository-library root>/<username>/<workspace-slug>/`,
  creating the username directory when needed, registers it, and links it directly
  to the Workspace.

**Create Workspace** stays disabled until a path and title are selected/entered,
and for the empty path until a short description is present. Rust validates the
repository identity, title, description, and destination before persisting the
Workspace. Show creation errors in the form and keep it open for correction or
retry; do not show a success state after a failed command. Successful creation
selects the Workspace and opens its ticket view. The user starts OpenCode later
with the ticket's **Work** action, rooted at the linked repository directory.

Cancel and Escape close the modal without creating records or touching Git.
Neither path changes the current terminal until creation succeeds. The shared
modal owns focus, close behavior, and scrolling; manually verify its appearance
and focus behavior on Wayland.

## Quick Request flow

This is a two-step flow:

1. **Resolve the directory.** The user chooses **Quick Request** from the New
   navigation dropdown, may change the prefilled working directory, and
   enters the original prompt. The internal proposal step's sole purpose is to
    resolve a working directory using the enabled repository list as its initial
    verified context. It may select only an enabled repository; Rust validates
    the selected repository and exact path. If the user changed the initial directory,
    the proposal must return that exact directory and receives no repository catalog.
    Otherwise it may select a matching enabled repository. The review field allows
    typing, choosing a folder, or resetting to the shared default. If no repository is identified, the proposal
   uses the shared default Quick Request directory. This step does not create a
   Quick Request, generate a replacement prompt, or create a terminal.
2. **Confirm and start.** The user reviews or corrects the resolved directory
   and confirms it.
   Rust creates the Quick Request under the special Quick Requests workspace,
    creates and records its exact OpenCode session and working directory, opens
     the Quick Request page with a **Quick Request / <name>** masthead above
     the terminal, which fills the remaining main work area, and sends the
     original prompt unchanged.

There is no workspace choice or editable starting-prompt step in this flow. The
terminal destination and navigation are specified in
[Quick Requests](screen-quick-requests.md).
