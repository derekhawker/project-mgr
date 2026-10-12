# Quick Request manual verification

## What this verifies

Confirm the user-facing Quick Request flow in a running Tauri prototype: submitting a request opens that request's interactive OpenCode session inside the GUI, the user can watch its response arrive live, and the user can send a follow-up in the same session.

See [`../../docs/opencode-terminal-e2e.md`](../../docs/opencode-terminal-e2e.md) for the shared implementation flow and integration contracts this Quick Request check validates.

This is a hands-on acceptance check, not something an API-only or mocked test can pass. A saved `2+3` session has been reopened through the built Tauri GUI, and its prompt and `5` response were visibly rendered in xterm without another model request; that is historical v1 evidence. This checklist covers explicit model selection, fresh-response streaming, and same-session follow-up behavior on the installed v2 CLI.

## Run the check

1. In `prototype/quick-request/`, run `npm install` once, then `npm run tauri -- dev`. Open **Quick Requests** in the Tauri window. Confirm the displayed OpenCode version and shared directory.
2. To inspect an existing result without sending another model request, click **Reopen latest**. Verify that its OpenCode session appears with the existing history.
3. Confirm the model selector defaults to `openai/gpt-6-luna`. If it is unavailable, choose another enabled model explicitly; do not proceed with an implicit OpenCode default. The prototype settings file is `quick-request-settings.json` in Tauri's per-user app-config directory.
4. Submit a prompt that should produce a visibly streamed response. For example: “Explain how a solar panel produces electricity in eight numbered sections, with two sentences per section. Start with section one and continue in order.”
5. Do not click a separate “open session” control. Verify that submitting the request automatically opens and focuses its interactive OpenCode session inside the GUI **before the first response begins**, and that the selected model is attached to that session.
6. While OpenCode is still responding, inspect the session. Verify that new output appears as it is produced, rather than appearing only after the response is complete or being shown only in a separate app-generated transcript. If the response finishes before you can observe output arriving, repeat with a longer prompt; a completed response alone does not prove streaming.
7. After the response completes, enter a follow-up in the open OpenCode session, such as: “Rewrite section three for a curious ten-year-old, keeping the other sections unchanged.”
8. Verify that the follow-up is accepted in that same session, its response streams in the same view, and the first prompt and response remain in that session's history.

## Pass criteria

- The Quick Request submission automatically opens the corresponding OpenCode session in the GUI.
- The model selector requires an explicit available choice, defaults to the configured model, and the resulting OpenCode session uses that model.
- The user can inspect the actual interactive session while the first response is in progress.
- The user can enter a follow-up through that session without creating another Quick Request or starting a new session.
- The follow-up response streams in the same view and the conversation history includes both turns.

If any of these fail, the terminal integration is not validated, even if the server API reports a successful session or completed response.

## Additional lifecycle checks

After the core flow passes, leave another Quick Request running and click **Hide view**. Reopen it from its session tab and verify that the same session continues and accepts follow-ups. Close the Tauri window and use the tray menu to show it again; confirm the session remains available. Then create a second Quick Request in the shared directory and verify that opening it shows its own session and history, not the first request's.
