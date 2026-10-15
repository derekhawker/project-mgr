# Tauri Testing Cliff Notes

Practical Linux testing notes for this repository, based on current Tauri v2
and Rust guidance.

## Unit and integration tests

- **Put application behavior in Rust.** Test validation, state transitions,
  persistence, process decisions, and command result/error serialization without
  launching a desktop. `cargo test` runs Rust's unit and integration tests;
  Rust tests can use `#[test]` and `#[cfg(test)]`. See *The Rust Programming
  Language*, Chapter 11, “Writing Automated Tests.”
- **Test both sides of every Tauri command.** Rust tests establish behavior and
  serialized results. Frontend tests establish command name/payload and the
  view's handling of returned values and errors. Keep frontend tests isolated
  and deterministic. This matches the repository's [GUI testing boundaries](gui-testing.md)
  and [integration-test matrix](integration-test-matrix.md).
- **Mock IPC only to test the frontend contract.** Tauri's
  `@tauri-apps/api/mocks` `mockIPC` intercepts frontend IPC; `mockWindows`
  provides window labels, not real window properties. Clear mock state between
  tests. These mocks do not execute Rust and therefore do not replace Rust
  command tests or real integration coverage. See Tauri v2’s “Mocking” testing
  guide.
- **Tauri Rust mock runtime has a boundary.** Tauri supports Rust unit and
  integration tests using a mock runtime, but native webview libraries are not
  executed in that runtime. Use it for command/runtime logic, not visual or
  native-webview acceptance. See Tauri v2’s “Tests” guide.

Typical Rust command from the repository root:

```sh
cargo test --manifest-path app/src-tauri/Cargo.toml
```

## End-to-end tests

- WebDriver tests launch the actual app and exercise user-visible behavior
  across components. Current Tauri recommends WebdriverIO with
  `@wdio/tauri-service`; its embedded provider supports Linux. Direct
  `tauri-driver` use is also available on Linux. See Tauri v2’s “WebDriver”
  guide for Linux prerequisites and setup.
- Current service integrations can also expose Tauri-specific execution,
  command mocking, and log capture; use the official guide for setup and
  provider-specific requirements.
- Use WebDriver for repeatable interaction and assertions in the running Tauri
  WebView. Perform visual/window checks in a Wayland session; an Xvfb run uses
  X11 and does not validate this app's Wayland behavior. See [GUI testing
  guidance](gui-testing.md) for the current setup and validation status.
- Existing Node tests may exercise production frontend adapters and cross a
  real Rust/CLI contract where explicitly configured, but do not describe those
  as native WebView or visual acceptance. The [integration-test matrix](integration-test-matrix.md)
  distinguishes these levels and records current gaps.

## Source note

Consult Tauri v2’s “Tests,” “Mocking,” and “WebDriver” guides, and *The Rust
Programming Language*, Chapter 11, for API details and setup.
