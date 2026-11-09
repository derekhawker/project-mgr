# Spacing weights

**Use shared whole-CSS-pixel weights for padding, margins, gaps, and overlay
offsets throughout the UI.** `theme.css` defines the `--ui-space-*` tokens;
the suffix is the value in CSS pixels. Importing `@ui-lib` loads them.

## Scale

The compact end advances in 2px steps; larger weights provide a section rhythm.
Choose the smallest weight that gives the content enough room.

| Token           | CSS pixels | Typical use                                               |
| --------------- | ---------: | --------------------------------------------------------- |
| `--ui-space-2`  |          2 | Tight separation, status inset                            |
| `--ui-space-4`  |          4 | Menu inset, small group gap, icon-button padding          |
| `--ui-space-6`  |          6 | Compact row padding, label gap, control vertical padding  |
| `--ui-space-8`  |          8 | Field horizontal padding, toolbar inset, related controls |
| `--ui-space-10` |         10 | Notice inset, compact panel padding                       |
| `--ui-space-12` |         12 | Button horizontal padding, form groups, page inset        |
| `--ui-space-16` |         16 | Modal body/frame inset, overlay edge clearance            |
| `--ui-space-20` |         20 | Drawer inset, list-marker indentation                     |
| `--ui-space-24` |         24 | Section separation                                        |
| `--ui-space-32` |         32 | Large separation, combined overlay viewport clearance     |
| `--ui-space-48` |         48 | Spacious standalone content                               |
| `--ui-space-64` |         64 | Large standalone section                                  |
| `--ui-space-96` |         96 | Hero separation; not workbench controls                   |

## Apply the scale

```css
.group {
  gap: var(--ui-space-8);
  padding: var(--ui-space-12) var(--ui-space-16);
  margin-block-end: var(--ui-space-16);
}
```

- Shared Button and default ActionMenu triggers own their padding through
  `--ui-control-padding` (6px vertically, 12px horizontally); compact ActionMenu
  triggers use the shared 4px/8px spacing. Compose those primitives instead of
  restyling their padding in a screen.
- Use spacing tokens in component CSS Modules and shell layout, including
  responsive rules. For viewport clearance use, for example,
  `calc(100vw - var(--ui-space-32))`.
- Keep `0` and `auto` literal. Preserve percentages used for anchoring or sizing.
- Keep border overlap and accessibility geometry literal and explain its purpose
  beside the rule: `.visually-hidden` uses a 1px box and `-1px` margin. These are
  not spacing weights.
- Typography, line height, icon/control dimensions, responsive widths, borders,
  and animation transforms have separate sizing concerns. Relative typography
  remains relative; a padding migration is not a font-size reset.
- When migrating a one-off value, choose the nearest weight while keeping related
  elements consistent. For example, `0.85rem` at a 16px root is 13.6px; use the
  12px weight for that compact gap rather than adding a 13.6px token.
- Extend the shared scale only for a demonstrated reusable need, and update this
  reference with the theme. Keep per-screen spacing on the existing scale.

## Pixel alignment and validation

Tokens are fixed CSS pixels, so changing the root font size does not turn padding
into fractional values. Browser zoom, device scaling, font metrics, percentage
layout, and animation can still produce fractional physical positions or sizes;
this scale does not promise device-pixel alignment for every rendered edge.

Verify computed spacing in browser checks, not CSS-source or layout unit tests.
Review compact and narrow-window layouts, wrapping, dialogs, and menus manually
on native Wayland before visual acceptance.
