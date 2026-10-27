# UI library

Solid presentation components live here, separate from Rust-owned application
behavior and screen-specific workflows. Vite compiles component CSS Modules;
`theme.css` supplies the shared gray, C64-inspired palette and gradient. CSS
custom properties can be overridden at runtime when an interaction needs it.

Import components from `./ui/index.js` (relative to `app/src/`); the entry point
also loads the theme. The initial set contains Button, Input, TextArea, Select,
Checkbox, ActionMenu, Modal, Drawer, Tabs, Notice and Status. ActionMenu supports
both native disclosures and controlled menus with app-owned state. Modal and Drawer
accept controlled `open` and `onCloseRequest` props; callers own any cleanup
needed before setting `open` to false. Tabs use controlled `value` and
`onChange`, and accept either `label` or `labelledBy` to name the tablist. When
the controlled value is absent or disabled, the first enabled tab remains the
roving keyboard entry point until a selection is made. Native form controls
forward standard HTML attributes (including `id`, `disabled`, and label-related
attributes); callers associate visible labels with their controls. Notice
defaults to a polite status announcement but callers may override its native
`role` and `aria-live` attributes when the message needs different semantics.
Modal and Drawer request closure through Escape or their close button, not
outside clicks. ActionMenu closes on outside pointer interaction, Escape, or an
enabled action; Escape returns focus to its summary. Dialogs and tab lists need
an accessible name; development builds warn if one is missing. Opening motion
is disabled when reduced motion is requested.
The existing New Work dialog still owns its native dialog lifecycle;
its form controls use the shared library without transferring lifecycle ownership. Directories uses shared form and checkbox controls, and Quick Request search uses the shared input.

Component tests cover interaction and semantics, not CSS or layout. Check
visual appearance, focus, native overlays, and window behavior manually on
Wayland.
