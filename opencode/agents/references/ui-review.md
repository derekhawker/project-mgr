# UI review reference

Use this guidance when reviewing changes that affect application screens or shared UI components.

## Presentation and product fit

- Review the change in its real screen and interaction context. Consider hierarchy, composition, typography, color, spacing, density, alignment, and visual rhythm; assess whether the result feels intentional and coherent, not only whether it preserves the prior layout.
- Check whether standardizing a pattern clarifies the experience or erases a useful distinction. Prefer coherence over uniformity and preserve purposeful variation.
- Inspect nearby views, `app/src/components/`, and `app/packages/ui-lib/` before flagging or recommending a new component. Keep product-neutral presentation primitives in the UI library and product-specific composition and behavior in application components.
- Raise component-boundary concerns only when reuse, consistency, behavior, or readability is materially affected.

## Interaction and accessibility

- Check keyboard operation, focus visibility, semantic structure, accessible names and states, and contrast.
- Consider responsive layouts and content extremes, including long labels, empty results, loading, and errors, when relevant to the change.
- Evaluate the complete interaction and feedback path, not just a static screenshot.

## Validation and ownership

- Review tests for user-visible behavior and contracts rather than CSS spelling. DOM or screenshot checks can help verify presentation, but a finding should identify a concrete behavior or usability problem.
- Follow `docs/ux/index.md` and the affected screen specification for UX requirements. Before reviewing product-behavior changes, consult `docs/application-workflows.md`.
- Respect the application boundary: Rust owns application behavior, validation, state changes, persistence, and process ownership; frontend code presents the UI and adapts Tauri commands.

For each issue, cite the relevant code and explain the user impact and why the behavior conflicts with the applicable requirement or pattern. Keep observations distinct from actionable findings.
