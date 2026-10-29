---
name: ui-component-design
description: Use when designing or refactoring app-specific UI components, deciding where presentation belongs, or reviewing component CSS. Use ui-library-extension for new shared UI primitives.
---

# UI component design

Choose the owner before adding markup or styles. Inspect the rendered component, existing primitives, and the CSS cascade that already affects it. Prefer changing the existing owner over adding a parallel abstraction or override.

## Guiding principles

Build UI in layers of increasing product specificity:

1. **Shared presentation components** in `app/packages/ui-lib/` provide product-neutral primitives and interactions: Button, Input, ActionMenu, Modal, and Tabs. They own common semantics, accessibility, theme, and interaction states. Application code imports their public entry as `@ui-lib`.
2. **Application-specific components** in `app/src/components/` compose those shared components and add product meaning. They own reusable app-specific names, icons, variants, and action wiring—for example, `DeleteButton` supplies the app's danger treatment, icon, and accessible name.
3. **Screen/feature composition** stays with its screen or feature owner. It composes the two lower layers for a local experience and should not be moved into a generic component folder without a reusable contract.

Prefer the existing component at the lowest layer that fully expresses the need. Add a higher-layer component when that layer owns a distinct reusable contract; do not copy shared behavior upward or push product-specific behavior downward.

Keep the presentation library outside application `src/`. Its own imports stay within the library or Solid; application-specific controls compose it from `app/src/components/`. See [library conventions](../../../app/packages/ui-lib/README.md) for packaging and alias resolution.

## SVG icons

- Keep SVG artwork centralized in the shared `Icon` component, inline in its SVG markup rather than scattered across screens or loaded through external `<use>` references. Use a `viewBox="0 0 16 16"` and the shared 1rem default (or its documented size variant) so icons align consistently.
- Keep decorative icons hidden from assistive technology and non-focusable; use `currentColor`, simple stroke geometry, and reduced opacity only when an icon accompanies visible button text.

## Prefer components when they own a contract

- Use an existing primitive for controls and common interactions when its API preserves the required semantics, accessibility, states, and behavior.
- Add an app-specific component when a repeated pattern has stable product meaning or must consistently own its accessible name, icon, variant, disabled behavior, or action.
- Keep native semantic markup for one-off content or when no component API fits. Do not make a wrapper solely to eliminate raw HTML.
- Keep presentation components presentational; application behavior and persistence stay with their established owners.

When the work changes the shared `app/packages/ui-lib/` API or its behavior, also follow [UI library extension](../ui-library-extension/SKILL.md).

## Keep styles with their owner

For padding, margins, gaps, overlay offsets, or responsive spacing, read the
[spacing weights reference](../../../app/packages/ui-lib/spacing.md) and use its
whole-CSS-pixel theme tokens across library and app components.

1. Search the component and all applicable CSS Modules, global styles, pseudo-states, and media queries before editing.
2. Put component styles in the component's CSS Module. A feature-level module may own styles shared by related components. Reserve `app/src/styles.css` for foundations, true app-wide defaults, and shell layout.
3. Let shared primitives own their control sizing, alignment, typography, borders, and interaction states. Prefer their variants and theme tokens. Add local rules only for a real layout or presentation need that the primitive does not own.
4. Give each state one authoritative rule. Remove obsolete or duplicate rules instead of appending a later override. Broad selectors such as `.shell button`, selectors grouped across unrelated controls, and repeated “final skin” blocks are warning signs: narrow the owner before changing presentation.
5. Keep minimum sizing intentional. Do not add control-specific `min-height` rules to toolbar, history, or Change Review actions; let their content and padding size them. A hit-area minimum elsewhere must have a specific accessibility or layout reason and belong to the owning component.

The recent cleanup exposed duplicate legacy/final style layers, broad shell-wide button overrides, component styling scattered through global CSS, and redundant control minimum heights. Use the search-and-single-owner rules above to prevent those patterns from returning; do not treat this paragraph as a list of current CSS locations.

## Validate behavior and appearance

- Test observable semantics and behavior: accessible name, native element behavior, callbacks, state changes, and disabled states. Do not test CSS declarations, class names, or layout in unit tests.
- Use browser DOM or screenshot checks when useful. Native Wayland rendering, focus, overlays, and lifecycle still require manual acceptance; a Chromium screenshot is not native acceptance.
- Review the final cascade for the edited component and report visual or native paths that were not checked.
