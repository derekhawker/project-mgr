---
name: ui-library-extension
description: Use when creating or extending a component, primitive, or styling capability in the project's custom UI library. Not for ordinary use of existing library components in app screens.
---

# UI library extensions

Create a library component when it improves ergonomics and code reuse. Start with an actual app use case; keep application workflows and business logic outside the library.

For the boundary between shared primitives, app-specific components, and screen styling, read [UI component design](../ui-component-design/SKILL.md).

## Design direction

For padding, margins, gaps, overlay offsets, or responsive spacing, read the
[spacing weights reference](../../../app/packages/ui-lib/spacing.md). It defines
the shared whole-CSS-pixel scale for the library and its consumers.

- Maintain one theme: gray, C64-inspired, flat UI with gradient backgrounds.
- Favor crisp geometry, clear borders, compact spacing, and restrained gradients over rounded, raised, or glossy controls. Keep text and interaction states legible.
- Design related components as a coherent set. Reuse theme values and existing primitives rather than introducing a new visual language for each component.

## Build

1. Inspect the existing Solid UI and library for the pattern being extended. Preserve useful native behavior and avoid copying app-specific state into a shared component.
2. Add unit tests for component behavior and meaningful interaction states using the project's existing test tools. Test observable behavior, not CSS declarations or layout.
3. Check the visual result manually, including relevant interaction states. Report what was not checked.

## Existing patterns to inspect

- Modal and form: `app/src/features/new-work/modal/NewWorkModal.jsx`.
- Disclosure menu: `app/src/features/new-work/NewWorkMenu.jsx`; controlled tools panel: `app/src/views/workspace/repository-tools/RepositoryToolsMenu.jsx`.
- Tabs: shared `app/packages/ui-lib/TabList.jsx`, `Tab.jsx`, and `test/tabList.test.js`; Workspace composition: `app/src/views/workspace/SessionTabList.jsx` and `WorkspaceShell.jsx`.
- Status and errors: `app/src/application/AppNotice.jsx`, `app/src/application/CommandResult.jsx`, and `app/src/features/new-work/modal/SetupProgressPanel.jsx`.
- Shared UI styling and conventions: `app/packages/ui-lib/README.md`, `app/packages/ui-lib/theme.css`, and the component CSS Modules beside each primitive; import from `@ui-lib`. Vite configuration: `app/vite.config.js`; editor paths: `app/jsconfig.json`.
