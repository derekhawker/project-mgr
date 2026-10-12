# GUI Testing Boundaries

## Highlights

- **System logic:** implement and test it in Rust; keep frontend unit tests focused on both sides of Tauri command contracts.
- **Visual acceptance:** window visibility, layout, terminal rendering, tray behavior, and lifecycle are manual Wayland checks for now.
- **Display isolation:** no automated display-isolation runner is retained. Xvfb exercises X11, not this Wayland app; a headless Weston approach was considered but not completed or validated.
- **Progress:** the production app's Rust/frontend unit tests and builds pass. The user reports completing the updated SQLite-enabled shell's manual Wayland verification; this remains user-reported rather than independently observed evidence. No I-02 GUI work was needed.

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

## Manual Wayland checks

Run the built or development app in the target Wayland session when reviewing
layout, rendered content, terminal behavior, window visibility, tray actions, or
application lifecycle. For the current shell, run `npm run tauri:dev` from
`app/`, bring its window to the foreground, and confirm `Connected to the Rust
core` and the Rust command response appear.

When a window appears missing, first determine whether it is covered by another
application. Do not treat an empty screenshot from a shared desktop as evidence
of an application failure. Record the compositor, exact interaction, observed
result, and any occlusion when reporting a manual check.

## Display-isolation attempts

The earlier Xvfb runner was removed because it forced GTK onto X11 and did not
exercise this Wayland application. A private headless Weston compositor was
considered as a Wayland replacement, but that runner was not completed or
validated. No automated GUI acceptance result is claimed from either attempt.

GUI and lifecycle automation remain deferred until the user explicitly reopens
that decision. Until then, keep those checks manual and cover application logic
through Rust and frontend unit tests.
