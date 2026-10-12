# Prototype decisions

Use this folder to record technical decisions needed before building the integration prototype.

Treat `.requirements.md` as the source of product requirements and `.opencode-handoff.md` as the approved technical direction. Record evidence, tradeoffs, unresolved questions, and a recommendation without silently changing either document.

The first investigation is the OpenCode terminal integration: how a Tauri GUI can provide the interactive terminal experience, connect it to the server API, and preserve session behavior when a terminal view or application window closes.

The primary acceptance check is user-operated. See [`quick-request-manual-verification.md`](quick-request-manual-verification.md) for the Quick Request flow that must be demonstrated in the running prototype.
