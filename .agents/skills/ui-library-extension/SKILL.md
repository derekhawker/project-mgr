---
name: ui-library-extension
description: Use when creating or extending a component, primitive, or styling capability in the project's custom UI library. Not for ordinary use of existing library components in app screens.
---

# UI library extensions

Create a library component when it improves ergonomics and code reuse. Start with an actual app use case; keep application workflows and business logic outside the library.

## Design direction

- Maintain one theme: gray, C64-inspired, flat UI with gradient backgrounds.
- Favor crisp geometry, clear borders, compact spacing, and restrained gradients over rounded, raised, or glossy controls. Keep text and interaction states legible.
- Design related components as a coherent set. Reuse theme values and existing primitives rather than introducing a new visual language for each component.

## Build

1. Inspect the existing Solid UI and library for the pattern being extended. Preserve useful native behavior and avoid copying app-specific state into a shared component.
2. Add unit tests for component behavior and meaningful interaction states using the project's existing test tools. Test observable behavior, not CSS declarations or layout.
3. Check the visual result manually on Wayland, including relevant interaction states. Report what was not checked.

## Existing patterns to inspect

- Dialog and form: `app/src/new-work-dialog.jsx`.
- Disclosure menu: `app/src/new-work-menu.jsx`; controlled tools panel: `app/src/repository-tools-menu.jsx`.
- Session tabs: `app/src/session-tab-list.jsx` and `app/src/session-tab-keyboard.js`.
- Status and errors: `app/src/app-notice.jsx`, `app/src/command-result.jsx`, and `app/src/setup-progress-list.jsx`.
- Current shared styling: `app/src/styles.css`; Vite configuration: `app/vite.config.js`.
