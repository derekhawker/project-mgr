# Presentation component library (`ui-lib`)

Solid presentation components live here, separate from Rust-owned application
behavior and screen-specific workflows. Vite compiles component CSS Modules;
`theme.css` supplies the shared gray, C64-inspired palette and gradient. CSS
custom properties can be overridden at runtime when an interaction needs it.

## Spacing

Use the [spacing weights reference](spacing.md) for padding, margins, gaps, and
overlay offsets in both library and application components. `theme.css` owns the
whole-CSS-pixel `--ui-space-*` scale and shared `--ui-control-padding` recipe.

## Components and packaging

This is the private npm workspace package `ui-lib`, outside the
application's `src/` tree. Import its public entry, which also loads the theme:

```js
import { Button, Modal } from "@ui-lib";
```

`npm ci` or `npm install` from `app/` links the workspace. Use `@ui-lib` in app and
test imports: `app/vite.config.js` supplies the runtime/build alias, and
`app/jsconfig.json` maps it for editor navigation. The test bundles reuse the
production alias. The workspace's `exports` also expose its public entry through
the package name `ui-lib`; internal component paths are not public. Consumers
compile its JSX and CSS Modules with Solid/Vite; this is not a prebuilt or
published package. Solid is a peer dependency, supplied by the application.

Keep this package presentation-only: it may depend on Solid and its own files,
not application screens, commands, state, or Tauri. Add reusable app-specific
meaning in `app/src/components/` instead. The library contains Heading, ErrorMessage, Button,
IconButton, Input, TextArea, Select, Checkbox, ActionMenu, ActionMenuItem,
ActionMenuGroup, ActionMenuSeparator, Collapsible, Modal, Drawer, TabList, Tab, Tabs,
Notice and Status. ErrorMessage supports inline and page-banner placements and
announces errors assertively.
Each component lives in its exact-name PascalCase file (`ActionMenu.jsx`,
`Status.jsx`); dedicated styles use the same stem (`ActionMenu.module.css`).
Shared styles such as `controls.module.css` remain shared. See
[frontend organization](../../README.md#frontend-organization) for application
and screen ownership.
Shared buttons and ActionMenu triggers use solid fills, modestly rounded corners,
a neutral border, and a layered lavender-gray shadow. Default buttons are white;
pressed controls use an inset shadow. Navigation items opt out of the shared
shadow and keep their flat treatment. Preserve clear focus, disabled, and variant
states.

Heading separates semantic level from its shared `hero`, `page`, `section`,
`subsection`, and `compact` visual sizes. IconButton provides consistent sizing
and SVG treatment. Button supports `primary`, `selected`, `danger`, and bordered
`ghost` visual variants. Modal uses the ghost variant for its close control.
Icon renders shared inline 16×16 SVGs at a consistent 1rem size, with an optional
muted treatment for icons paired with text. Keep its SVG artwork inline in
`Icon.jsx`, not scattered through screen markup or external files.
The folder tree uses the `folder` and `folderOpen` artwork to distinguish
collapsed and expanded directories.
Button owns the token-based gap between an icon and its visible label.
Collapsible provides a native, initially collapsed section with a shared SVG
chevron. Its optional `maxHeight` accepts a CSS length and makes the content
independently scrollable and keyboard-focusable.
App-specific actions such as
DeleteButton belong in `app/src/components/` and compose these primitives.
ActionMenu supports both native disclosures and controlled menus with app-owned
state. Its summary trigger shares Button's base control styling and accepts the
same visual variants. A decorative shared SVG chevron replaces the native marker
and rotates smoothly on opening and closing; the summary retains native disclosure
behavior and its accessible label. `direction="down"` (default) places the popup
below the trigger, with a down-pointing chevron when closed and up when open.
`direction="up"` places it above with a 4px gap and reverses those chevron states.
ActionMenu owns placement, popup entry direction, and chevron rotation for both
native and controlled menus; reduced motion disables both animations.
ActionMenu defaults to the purple accent surface used by New work and Tools;
`surfaceVariant="neutral"` explicitly selects the neutral surface. Compose
`ActionMenuItem` for flat, left-aligned, full-width rows instead of ordinary
Button controls. Rows have no button border or rounding; hover/focus highlights
the row. They retain native button attributes, disabled behavior, Tab navigation,
and Enter/Space activation. These disclosures are not ARIA arrow-key menus.
`ActionMenuGroup label="Open in…"` provides a semantic section and compact
heading, with its contents indented below it. Nest groups with `headingLevel={3}`
for subheadings: primary headings use light cyan, nested headings light lavender.
`ActionMenuSeparator` provides a non-focusable horizontal divider. Group and item
styles, typography, and indentation belong to the library; callers own only
screen layout and action wiring. For example:

```jsx
<ActionMenu label="Tools">
  <ActionMenuGroup label="Open in…">
    <ActionMenuItem onClick={openTerminal}>Open terminal</ActionMenuItem>
  </ActionMenuGroup>
  <ActionMenuSeparator />
  <ActionMenuGroup label="Scripts">
    <ActionMenuItem onClick={runTests}>Test</ActionMenuItem>
  </ActionMenuGroup>
</ActionMenu>
```

Modal and Drawer
accept controlled `open` and `onCloseRequest` props; callers own any cleanup
needed before setting `open` to false. Modal also accepts a native dialog `ref`
without `open` for an existing imperative lifecycle owner. Do not mix the two
opening modes. Its `title` names the dialog and appears beside a labelled close
icon. `children` occupy the scrollable body; optional `footer` actions stay
visible with the header. `size="compact"` (default) and `size="wide"` change
width, never force height. Native attributes such as `id` and `aria-describedby`
are forwarded. Tab/Shift+Tab wrap within visible enabled controls; closure
returns focus to the opener (or its disclosure trigger when opened from a menu).
TabList and Tabs use controlled `value` and `onChange`, and accept either `label`
or `labelledBy` to name the tablist. When the controlled value is absent, hidden,
or disabled, the first visible enabled tab remains the roving keyboard entry
point until a selection is made. Native form controls
forward standard HTML attributes (including `id`, `disabled`, and label-related
attributes); callers associate visible labels with their controls. Notice
defaults to a polite status announcement but callers may override its native
`role` and `aria-live` attributes when the message needs different semantics.
Modal and Drawer request closure through Escape or their close button, not
outside clicks. ActionMenu closes on outside pointer interaction, Escape, or an
enabled action; Escape returns focus to its summary. Dialogs and tab lists need
an accessible name; development builds warn if one is missing. Opening motion
is disabled when reduced motion is requested.
New Work composes Modal's shared header, scroll body and action footer while
its existing controller retains native open/close and asynchronous cleanup
ownership. Its external submit button targets the capture form with the native
`form` attribute, preserving validation and keyboard submission. Directories uses
shared form and checkbox controls, and Quick Request search uses the shared input.

Component tests cover interaction and semantics, not CSS or layout. Check
visual appearance, focus, native overlays, and window behavior manually on
Wayland.

## Tab strips and panels

Use `TabList` and `Tab` when the screen owns panel lifetime, especially for live
terminals. Switching selection does not mount, unmount, or stop any panel:

```jsx
<TabList label="Workspace views" value={selected()} onChange={setSelected}>
  <Tab value="code" id="code-tab" controls="code-panel">OpenCode</Tab>
  <Tab value="docs" id="docs-tab" controls="docs-panel" disabled={noDocs()}>Docs</Tab>
</TabList>
```

The caller supplies matching panel IDs, `role="tabpanel"`,
`aria-labelledby`, and panel visibility. `Tab` forwards native button attributes
and `onClick`; preventing that event suppresses `onChange`. Tabs generate unique
IDs unless the caller supplies one; use explicit IDs for external panel labels.
Use `Tabs` with
`{ id, label, panel, disabled }` records for simple content: it builds those
associations and renders only the selected panel's content.

Keep an active view tab focusable while its panel loads; guard duplicate opens
in the screen adapter rather than disabling the selected tab mid-activation.

The shared strip is recessed, with a solid darker background and
an inset shadow rather than a gradient; unused space keeps that treatment while
tab surfaces match the surrounding
page rather than floating above it. The active tab uses the shared primary
background and contrasting text, not a border or inset selection marker.
Tabs form a joined button group: no strip padding or gaps, one divider between
neighbors, and rounded corners only at the left end of the first visible tab.
Tabs reuse the shared control typography, label padding, and interaction states
used by Button and ActionMenu triggers; selection does not change the label's
weight or size. The strip wraps instead of hiding tabs
behind horizontal overflow.
Arrow keys follow the list orientation and wrap; Home/End choose the first/last
visible enabled tab. Activation keeps focus on the tab, including when callers
replace their tab records. Enter/Space retain native button activation.

Supply `Tab.onClose` and `closeLabel` for a closeable tab, with `closeDisabled`
when closing is unavailable. Each closeable tab has its own adjacent × button,
even when inactive. Tabs without `onClose` have no ×. Closing calls only the close
handler, never selection; the caller owns removal and selection fallback. When
removal takes away a focused close button, focus returns to the selected or
first enabled tab unless the user has already focused another control.

`Tab.actions` accepts selected-tab controls such as Restart, shown in a separate
labelled group beside the strip. Close and Restart remain ordinary sibling
buttons, never nested inside a tab button. The ARIA tablist uses `aria-owns` to
include only visible tabs in visual order, excluding close/action buttons.
Arrow keys never activate these buttons. Process ownership stays outside the
library.

Tab interaction, accessibility, and dynamic-membership tests live in
`test/tabList.test.js` in this workspace. Run `npm test --workspace ui-lib` from
`app/`; the application’s default `npm test` also includes them. Application DOM
tests cover screen wiring rather than repeating the component behavior matrix.
