# Workspace screen

> **Workspace-only refactor in progress:** Workspace is the sole regular work
> record. Legacy Task metadata is retained internally for compatibility, but
> archived records are not listed or restored in the UI. See
> [`../workspace-refactor-target.md`](../workspace-refactor-target.md).

## Ticket browser and workspace

Selecting a Workspace opens its ticket browser. The browser presents a compact,
sortable list beside a separate selected-ticket reader. Each row starts with a
tag-style status, then the title (which selects the ticket), and an icon-only
folder action that starts **Work** on active tickets. Rows have no body previews,
and selection is visually distinct. The list can grow to half the ticket pane,
up to 800px. The default sort is `blocked`,
`in_progress`, `draft`, then other statuses, with newest modification first
within each status. **Status**, **Recently modified**, and **Title** are the
available sort choices in a compact ActionMenu. Active/Archived uses a shared
binary switch, and Refresh stays beside it in the list toolbar. Keep the ticket
list flat, without an enclosing card or border; use a primary **Create ticket**
action above it. List and reader scroll independently. The reader shows
the full sanitized Markdown body followed by formatted ticket frontmatter.
The ticket-list `ul` owns shared grid columns: content-sized status tags, a
flexible title, and a fixed action column. Long wrapped titles expand their row
without forcing horizontal page overflow.
The browser uses the shared page masthead, `Workspace / <workspace name> / Tickets`;
the selected ticket title appears in the reader, not in this container heading.

Above the browser, show the app-wide **Default Model** control from OpenCode's
enabled catalog. Use the shared ActionMenu for the model dropdown. If its saved
value is unavailable, show an explicit choose-model state instead of silently
selecting another model. The primary **Create ticket** action opens a two-step
dialog. Its progress indicator shows connected numbered circles **1** and **2**,
outlines the active circle, fills the other, and places one summary below:
**Description** or **Review**. The first
step captures an idea; the second displays an editable title and Markdown body
with the app-managed `draft` status read-only. Cancel creates no file.
Confirmation creates the ticket in external Workspace storage; success closes
the dialog and selects the refreshed ticket, while failure keeps the review step
and edits visible.

The ticket browser's **Tools** menu is available even with no selected ticket.
It offers only external-terminal, IntelliJ, and folder actions, using the
Workspace's verified repository checkout. It has no in-app terminal or
project-command actions. Selecting a ticket establishes context but does
not show the session tabs. Activating **Work** opens or resumes its interactive session. The heading is
`Workspace / <workspace name> / Tickets / <shortened ticket title>`; the
workspace name is a button that returns to the ticket list without closing the
session.

The ticket workbench starts with a **New session** button immediately before the
session/view tab strip. It creates a fresh conversation bound to the selected
ticket, makes it active, and keeps earlier ticket sessions available as tabs.
Ticket tabs use stable session labels. Closing a tab closes its terminal and
removes its ID from that ticket; it does not delete OpenCode's conversation
history. Closing the active tab selects the most recently retained session.

## Purpose and layout

The workspace screen is the main application surface for a Workspace and its
Workspace-owned interactive sessions. The persistent left navigation lists
Workspaces directly; legacy Task rows are not shown as work destinations.
Quick Requests remain a separate tracked flow above the Workspace list.

Keep the app shell anchored to the window. Only the selected main pane scrolls.
The post-Work shell starts with the shared masthead, showing the Workspace name
and ticket breadcrumb. It stays visible across terminal, Docs, and Change Review
views. Long names wrap rather than widening the work area. The compact
Workspace/session toolbar sits below the masthead, followed by the full-size interactive
terminal. The terminal viewport reaches the work-area edges without an extra
title strip or inset padding. C64-inspired color is reserved for navigation selection
and focused controls. It remains the primary work area without an app transcript
or persistent status panel.

New ticket-session terminals open in the ticket's recorded, Git-verified
worktree, or in the Workspace repository checkout when no worktree is recorded.
A stale or foreign recorded path is reported instead of silently routing to a
different checkout. Native OpenCode worktree creation may update the ticket's
current associated path; shell-created worktrees are not automatically tracked.
Ticket-workbench Tools, Change Review, and Docs use that same selected-ticket
directory. The workbench Tools menu offers both its in-app terminal and a
separate external-terminal action; discovered commands identify their source
directory and run there. With no selected ticket, only the Tickets-view Tools
menu is shown and it offers external actions targeting the Workspace repository
checkout.
The ticket workspace after Work has no Workspace options collapsible or its
controls. Clear the workspace-loading status after the terminal opens.

The navigation is a quiet gray rail with a subtle divider. Quick Requests and
Workspaces form a continuous list, without section cards or hard rules. Labels
use normal case and restrained weight. Selected destinations use C64 purple;
primary actions use a muted terracotta accent. Keep the full-width Directories
and New work controls together at the bottom of the rail, with Directories
immediately above New work. Directories uses the default shared button
treatment with a decorative SVG folder beside its label; New work uses the
shared SVG disclosure chevron rather than a browser-rendered triangle. Both
keep their visible labels. New work is a full-width disclosure action with a C64-colored menu
surface and readable contrasting items. Use compact outlined controls with
near-square corners. Long Workspace names
stay on one line and truncate visually while retaining their full accessible
name. When empty, explain that New below creates a Workspace. OpenCode sessions,
open terminals, Change Review, and Docs share one rounded, recessed tab strip.
The tab surfaces sit flush with the surrounding gray page, not above it. The
selected tab uses the theme's primary background and contrasting text instead
of a border or inset marker. Tabs wrap when needed.
Tabs form a joined button group without strip padding or gaps. Use one divider
between tabs and rounding only at the group's left end, even when earlier
owner tabs are hidden. Label typography and padding match Tools; selection does
not enlarge or embolden a label. Unused strip space keeps the solid darker gray
background and inset shadow, not a gradient.
Each closeable session has an × beside its own label, including inactive tabs.
Docs and Change Review have no close button. Closing an inactive session does
not select it first. Restart remains a separate action for the selected
terminal. These controls are never nested inside tab buttons. Tools stays outside the tablist in
the same compact toolbar. Use a restrained monospace face for navigation labels and
controls, with one shared button height and padding. Ghost buttons stay flat
until hovered; then use only a slight lift and soft shadow. Pressing a button
should feel gently inset. Keep menu rows flat. The empty state is simple and
centered, without console-style labels.

Navigation, toolbars, menus, and inline panels use the shared whole-CSS-pixel
[spacing weights](../../app/packages/ui-lib/spacing.md). The terminal itself
remains edge-to-edge; consistent spacing must not add an inset around it.

Keep the selected session identity in the session tab and let that tab own the
primary selection fill. The Workspace masthead belongs to the shell, not the
terminal surface; do not add another terminal title strip. Quick Requests use
their own destination masthead instead.

## Workspace behavior

The persistent left navigation offers an icon-only control beside **Workspaces**
to switch between grouped Workspace → ticket rows and a flat ticket list.
Grouped mode starts each Workspace expanded; only Workspaces with `in_progress`
or `blocked` tickets show a right-side disclosure control. The Workspace name
continues to select that Workspace; the separate disclosure changes only ticket
visibility. Ticket rows show the title, clamped to two lines, and a left circle-X
only for blocked tickets. Selecting a row runs that ticket's existing **Work**
action. Flat mode keeps Workspace rows first, shows a divider, then lists matching
tickets across Workspaces by newest filesystem modification time; ticket rows do
not show Workspace names or timestamps, and Workspace disclosures are hidden.
Rust watches ticket Markdown files and refreshes the navigation data when they
change. The visual controls, truncation and native Wayland appearance remain
manual acceptance.

- The New work menu offers Workspace and Quick Request. Workspace confirmation
  selects the new Workspace and opens every required session, even when the
  optional starting prompt is blank.
- Workspace sessions use persisted roles and repository associations for their
  tab labels: **Workspace** with no repositories, the repository name for each
  worker, and **Orchestrator** for multi-repository workspaces.
- Tabs belong to the selected Workspace. Restore exact recorded OpenCode session
  IDs and working directories; do not guess from the newest session in a
  directory. Navigate to the Workspace immediately, show loading status in its
  work area while sessions attach, and keep restore failures visible there.
  Users interact with OpenCode in the attached terminal.
- Left/Right arrows move focus and selection through the selected Workspace's
  visible, enabled session and document/review tabs, wrapping at either end;
  Home/End choose the first/last. Focus stays on the activated tab so repeated
  navigation works; Tab reaches the per-tab close buttons and selected terminal's
  Restart action. If closing removes the focused ×, focus returns to the selected
  tab rather than a hidden terminal.
  Loading a reader keeps its selected tab focusable while duplicate opens are
  blocked.
  Hidden tabs belonging to other owners never participate. Returning to an owner
  retains its remembered session, including a still-open tool terminal.
- Change Review appears only when the Workspace has associated repositories.
  Docs is always listed, disabled after discovery confirms no documents. It
  lists Workspace-home and verified repository files. Both destinations
  leave terminal sessions available and return without stopping them.
- Tools presents Workspace OS handoff actions before repository tools.
  The **Open in…** section sits above the repository scripts, separated by a
  horizontal divider. Its buttons stack vertically, one full-width button per row.
  Repository script groups may sit side by side below it. When there are no
  associated repositories, omit the repository section and its divider.
  The menu sizes to its contents with a modest minimum width, not the work area's
  width; it stays within the viewport and wraps repository groups when needed.
  Tools and New work share the purple menu surface and flat, left-aligned action
  rows, not outlined buttons. Light-cyan section headings and light-lavender
  script subheadings distinguish the hierarchy; each group's items are indented
  beneath its heading. Shared menu items, groups, and dividers own this treatment
  in the UI library. Items retain native Tab and Enter/Space behavior.
  Rust resolves and validates Workspace-owned paths; the GUI does not supply paths.
  Tools uses the same disclosure menu as New work. Clicking outside closes it;
  Escape closes it and returns focus to Tools. Tool action status remains visible
  in the menu while an action runs.
  Tool terminals are separate interactive sessions and closing one stops only
  its process.
- Workspace completion is a lifecycle change, not a commit, merge, or discard.
  It preserves the Workspace and its OpenCode history. Any worktree cleanup must
  preserve dirty or in-use data.

## Quick Requests

Quick Requests keep their existing separate destination and lifecycle. Opening
one shows its exact tracked OpenCode session in a dedicated terminal page, with
navigation still visible. It has no
Workspace tabs, repository controls, or Workspace lifecycle actions.

## Compatibility boundary

Legacy Task records and backend commands remain during the staged refactor, but
the regular workspace screen does not select or operate on those records. Their
legacy-data compatibility behavior is specified in
[`../workspace-refactor-target.md`](../workspace-refactor-target.md) and is
deferred to the final migration stage.

## Acceptance

Layout, rendering, terminal, window, tray, lifecycle, and Wayland behavior are
manual acceptance checks. Automated command and DOM tests do not establish
native Tauri or visual acceptance.
