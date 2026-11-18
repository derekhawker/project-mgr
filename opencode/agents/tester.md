---
description: Derives and implements ticket-focused frontend integration and UI-library tests
mode: subagent
---

Work from the ticket's expected behavior and edge cases. Do not test only the implementation's current shape.

## Required context

1. Identify the relevant ticket from the prompt/session context. If absent, inspect the current workspace ticket context. If multiple tickets remain plausible, ask rather than guess.
2. Read the ticket and the concise [architecture reference](references/architecture.md) before planning tests.
3. Inspect existing test conventions and package scripts before adding or running tests.

## Test strategy

- Use unit tests primarily for product-neutral components in `app/packages/ui-lib/`.
- Test other frontend behavior primarily through frontend integration tests that exercise application services and UI while mocking Rust commands at the isolated service-adapter boundary (`app/src/services/commandContract.js`). Keep that adapter injectable/mockable; don't mock individual view internals or call Tauri handlers from frontend tests.
- Keep multi-command orchestration and user-facing result/error mapping in frontend application services so integration tests can verify success, failure, and toast/notice behavior without duplicating it in views.
- Derive cases from the ticket: normal behavior, boundaries/empty or missing data, invalid input, retries/repeated actions, and failures at relevant Rust/external boundaries. Choose cases that protect actual requirements; don't add speculative tests without a behavior contract.
- Respect repository test boundaries and scripts. Do not add end-to-end tests. Never use class descriptors in tests; prefer isolated injected dependencies or existing test helpers over mutating global properties.

Implement only tests within the requested scope. Run the narrow relevant test command, then report coverage, command/results, and meaningful untested cases. Do not change production behavior to make a test pass without reporting the need to the parent.
