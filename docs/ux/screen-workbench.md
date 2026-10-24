# Workspace Workbench

> **Workspace-only refactor in progress:** Workspace is the sole regular work
> record. Legacy Task data remains stored for the final archive/restore
> migration, but Task selection and controls are not part of the UI. See
> [`../workspace-refactor-target.md`](../workspace-refactor-target.md).

## Purpose and layout

The workbench is the main application surface for a Workspace and its
Workspace-owned interactive sessions. The persistent left navigation lists
Workspaces directly; legacy Task rows are not shown as work destinations.
Quick Requests remain a separate tracked flow above the Workspace list.

Keep the app shell anchored to the window. Only the selected main pane scrolls.
The compact Workspace/session toolbar sits above a full-size interactive
terminal. The terminal viewport fills the available work area without an inset
card, fullscreen control, transcript, or persistent status panel.

## Workspace behavior

- The New work menu offers Workspace and Quick Request. Workspace confirmation
  selects the new Workspace and opens every required session, even when the
  optional starting prompt is blank.
- Workspace sessions use persisted roles and repository associations for their
  tab labels: **Workspace** with no repositories, the repository name for each
  worker, and **Orchestrator** for the multi-repository coordinator.
- Tabs belong to the selected Workspace. Restore exact recorded OpenCode session
  IDs and working directories; do not guess from the newest session in a
  directory. Users interact with OpenCode in the attached terminal.
- Change Review appears only when the Workspace has associated repositories.
  Docs lists Workspace-home and verified repository files. Both destinations
  leave terminal sessions available and return without stopping them.
- Tools presents Workspace OS handoff actions before repository tools. Rust
  resolves and validates Workspace-owned paths; the GUI does not supply paths.
  Tool terminals are separate interactive sessions and closing one stops only
  its process.
- Workspace completion is a lifecycle change, not a commit, merge, or discard.
  It preserves the Workspace and its OpenCode history. Any worktree cleanup must
  preserve dirty or in-use data.

## Quick Requests

Quick Requests keep their existing separate destination and lifecycle. Opening
one shows its exact tracked OpenCode session in a dedicated terminal page, with
navigation still visible and a **Back to Quick Requests** action. It has no
Workspace tabs, repository controls, or Workspace lifecycle actions.

## Compatibility boundary

Legacy Task records and backend commands remain during the staged refactor, but
the regular workbench does not select or operate on those records. Their
eventual archive, conversion, and undelete behavior is specified in
[`../workspace-refactor-target.md`](../workspace-refactor-target.md) and is
deferred to the final migration stage.

## Acceptance

Layout, rendering, terminal, window, tray, lifecycle, and Wayland behavior are
manual acceptance checks. Automated command and DOM tests do not establish
native Tauri or visual acceptance.
