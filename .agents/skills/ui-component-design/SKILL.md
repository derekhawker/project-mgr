---
name: ui-component-design
description: Use when designing or refactoring app-specific UI components and deciding where presentation belongs.
---

# UI component design

## Guiding principles

### Component discovery and boundaries

1. **Find before building:** check `app/packages/ui-lib/index.js` for a shared component, then check `app/src/components/` and nearby views for app-component examples.
2. **Compose in views:** use components for controls; keep raw controls such as `<button>`, `<h1>`, `<input>`, and `<select>` out of views. A view assembling a recurring product pattern—such as a modal—may also need an app-component boundary.
3. **Choose the right layer:** shared UI components provide product-neutral building blocks; app components own product-specific presentation and composition. Componentize coherent elements when that improves readability or makes presentation/interaction easier to change, even for a single use.
4. **Follow useful precedent:** when similar app components exist, follow their structure and styling where it fits. Preserve intentional differences when the product needs them.
5. **Limit styling options:** keep app-component CSS and styling props focused on the product's intended appearance. Avoid extra variants and overrides that let callers create inconsistent versions.

Build UI in layers of increasing product specificity:

1. **Shared presentation components** in `app/packages/ui-lib/` provide product-neutral primitives and interactions: Button, Input, ActionMenu, Modal, and Tabs. They own common semantics, accessibility, theme, and interaction states. Application code imports their public entry as `@ui-lib`.
2. **Application-specific components** in `app/src/components/` compose those shared components and add product meaning. They own reusable app-specific names, icons, variants, and action wiring—for example, `DeleteButton` supplies the app's danger treatment, icon, and accessible name.

Keep the presentation library outside application `src/`. Its own imports stay within the library or Solid; application-specific controls compose it from `app/src/components/`. See [library conventions](../../../app/packages/ui-lib/README.md) for packaging and alias resolution.

## SVG icons

- Keep SVG artwork centralized in the shared `Icon` component, inline in its SVG markup rather than scattered across screens or loaded through external `<use>` references. Use a `viewBox="0 0 16 16"` and the shared 1rem default (or its documented size variant) so icons align consistently.
- Keep decorative icons hidden from assistive technology and non-focusable; use `currentColor`, simple stroke geometry, and reduced opacity only when an icon accompanies visible button text.

## References

- For shared UI-library components and conventions, see [`app/packages/ui-lib/docs/components.md`](../../../app/packages/ui-lib/docs/components.md).
- For spacing tokens, see [spacing weights](../../../app/packages/ui-lib/docs/spacing.md).
