# Workspace Refactor Validation Handoff

Run this checklist on Wayland with the supported installed OpenCode v2 CLI. The
automated Rust, frontend, and command-contract suites do not establish native
Tauri rendering, PTY behavior, window/tray lifecycle, or OpenCode plugin loading.

## Workspace creation and sessions

- Create a Workspace with no repositories and no starting prompt. Confirm one
  Workspace-home session starts and its tab is labeled **Workspace**.
- Create with one repository and a nonblank starting prompt. Confirm one worker
  starts at the canonical worktree root, the prompt goes only to it, the source
  checkout is unchanged, and the Workspace alias resolves to the recorded
  worktree.
- Create with two repositories and a blank starting prompt. Confirm an
  **Orchestrator** outside both repos and one empty worker per repository start;
  labels and directories match the persisted associations.
- Repeat multi-repository creation with a starting prompt. Confirm it is sent
  only to the orchestrator. In the orchestrator TUI, invoke
  `workspace.send_to_repository_worker` for each repo and verify admission is
  acknowledged for the exact worker. Confirm unknown repository IDs and blank
  prompts fail, and no worker transcript is copied into app storage.
- Induce a setup/session-start failure and retry. Confirm the same persisted
  library, worktree, branch, and alias paths are reused without duplicates.

## Workbench and Quick Request regression

- Confirm navigation and New work expose Workspace and Quick Request only; no
  regular Task destinations, controls, or setup polling appear.
- Exercise Workspace terminal tabs, Change Review, Docs, repository tools, and
  OS handoff. Switch destinations and return; existing interactive terminals
  must remain attached. Complete/reactivate a Workspace and confirm user files,
  worktrees, branches, and OpenCode history remain untouched.
- Create, open, follow up, search, and delete a Quick Request. Confirm its
  dedicated terminal page, back navigation, original prompt behavior, and
  deletion semantics remain unchanged.
- Open Directories and restore a legacy archive fixture. Confirm the archive is
  marked restored, the compatibility record does not become a regular
  navigation destination, and no filesystem or OpenCode history changes.

## Native lifecycle

- Resize and hide/show the app window while terminals run; verify PTYs continue
  and output is recovered. Exercise tray **Show** and **Quit**, verifying child
  cleanup on full quit.
- Check terminal input, resize, session switching, startup/retry errors, modal
  review/confirmation, and repository-directory picker behavior at normal and
  narrow window sizes.

Record the OpenCode version, Wayland compositor, scenarios run, and any failure
before marking Task 8 accepted. Do not treat a successful build or Rust test as
evidence for these manual checks.
