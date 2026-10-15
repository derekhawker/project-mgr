# GUI Testing

For a concise overview of Rust unit tests, frontend command-contract tests, and
Tauri end-to-end options, see [Tauri Testing Cliff Notes](tauri-testing-notes.md).

## Highlights

- **System logic:** implement and test it in Rust; keep frontend unit tests focused on both sides of Tauri command contracts.
- **WebView E2E:** use Tauri's WebDriver integration for automated interaction and assertions against the running app. It is not configured in this repository yet.
- **Visual acceptance:** inspect the app in a Wayland session. Xvfb exercises X11 and does not establish Wayland behavior.
- **Current validation:** no visual acceptance was completed in this session. The app process was running, but the captured desktop showed a locked KeePass dialog rather than the app, so no UI result is claimed.

## Automated tests

Keep behavior independent from the GUI. Rust owns application rules, validation,
state transitions, persistence, and process ownership. For each Tauri command:

- Rust unit tests cover behavior, validation, and serialized response/error
  shapes.
- Frontend unit tests cover the invoked command name and payload, and how the
  frontend maps returned data and errors into the view.

The automated frontend and Rust tests are the primary checks for application
logic. Keep them local and deterministic; do not require a running desktop or
provider service for these contracts.

## Wayland visual checks

Run the built or development app in the target Wayland session when reviewing
layout, rendered content, terminal behavior, window visibility, tray actions, or
application lifecycle. For the current shell, run `npm run tauri:dev` from
`app/`, bring its window to the foreground, and confirm `Connected to the Rust
core` and the Rust command response appear.

When a window appears missing, first determine whether it is covered by another
application. Do not treat an empty screenshot from a shared desktop as evidence
of an application failure. Record the compositor, exact interaction, observed
result, and any occlusion when reporting a manual check.

## Display and automation notes

The earlier Xvfb runner was removed because it forced GTK onto X11 and did not
exercise this Wayland application. A private headless Weston compositor was
considered but not completed or validated. These facts do not rule out adding a
Wayland-capable automated test setup; validate its compositor and WebView
behavior before treating it as acceptance coverage. Keep automated WebDriver
assertions distinct from visual review and from Rust/frontend unit tests.
