# Interactive terminal renderer research

## Decision and implementation record

**Approved 27 October 2026:** attempt the WebGL renderer by default for every
xterm terminal. Keep xterm's built-in DOM renderer as automatic fallback if
WebGL initialization fails or its context is lost. Preserve the existing PTY,
session, replay, input, resize, hide/reopen and cleanup contracts. Do not claim a
performance improvement before measuring it on the target WebView.

This supersedes the earlier opt-in trial decision. The compatible packages are
already installed: `@xterm/xterm` 5.5.0, `@xterm/addon-fit` 0.10.0, and
`@xterm/addon-webgl` 0.18.0. Both workspace and Quick Request terminals, plus
tool terminals, share `TerminalRuntime`.

### Approved slices and progress

- [x] Record the approved scope: make a WebGL attempt unconditional in both
  attachment paths; retain DOM fallback on initialization failure/context loss;
  do not change Rust, session ownership, or terminal workflows.
- [x] Update the runtime and focused tests to prove default WebGL activation,
  fallback, context-loss cleanup, and stable behavior for both attachment paths.
- [x] `npm test --prefix app` passed **237/237**; terminal-runtime cases cover
  default activation in both attach paths, initialization fallback, context-loss
  release, and addon teardown. Existing session/input/resize/replay tests passed.
- [x] `npm run build --prefix app` passed (Vite 6.4.4, 113 modules). A browser
  fixture in Chromium 153 opened the existing Workspace session and confirmed an
  active WebGL2 canvas. Forcing context loss via `WEBGL_lose_context` removed the
  WebGL canvas, kept the xterm terminal mounted, and retained rendered fixture
  output through fallback. This is a browser smoke check, not native WebKitGTK
  evidence.
- [x] Updated the integration matrix and rebuilt the Tauri release artifact with
  `npm run tauri:build --prefix app`; `npm audit --prefix app` reported zero
  vulnerabilities and `git diff --check` passed. Artifact:
  `app/src-tauri/target/release/opencode-project-manager`.
- [ ] Human gate: compare rendering and responsiveness on the actual
  Wayland/WebKitGTK target and report environment/workload. Native acceptance
  and performance benefit remain unverified until this is done.

**Approval reference:** user approved the bounded WebGL-default/DOM-fallback plan
in this conversation on 27 October 2026. The approved outcome is the default
renderer attempt, not a performance claim; native Wayland comparison remains a
separate acceptance gate.

## Evidence from this repository

- `app/package.json` and its lockfile pin xterm 5.5.0 and fit addon 0.10.0.
- `app/src/terminal/terminalRuntime.js` constructs `Terminal` in both `attach` and
  `attachExisting`, loads `FitAddon`, opens the terminal, registers input and
  XTGETTCAP handling, replays output, resizes the PTY, and disposes the terminal
  on detach. Both workspace and Quick Request sessions use this runtime.
- WebGL 0.18.0 is installed and is selected by default after `terminal.open`;
  xterm's built-in renderer remains the fallback.
- `docs/application-workflows.md` requires preserving the exact session and
  directory, PTY input/output, resize, replay, and hide/reopen lifecycle.

## Renderer options

### Canvas

The xterm 5.5.0 release lists `@xterm/addon-canvas` 0.7.0 as a compatible
addon. However, xterm maintainers merged removal of that addon for the next
major release (6.0), recommending DOM or WebGL instead. Canvas is thus a
short-lived choice for this dependency line, not a sensible new long-term
integration. The official release notes do not establish a general, workload-
independent performance gain over the current DOM renderer.

### WebGL

The xterm 5.5.0 release lists `@xterm/addon-webgl` 0.18.0 as compatible, and
the current xterm addon guide documents loading addons with `Terminal.loadAddon`.
The official WebGL addon is explicitly a WebGL2 renderer and documents context
loss; compatibility at the JavaScript API/package level is established for
this xterm version, but that does not establish runtime availability or a
performance win on every Tauri platform.

Tauri's Linux documentation states that Linux uses WebKitGTK and warns that
WebGL2 can successfully initialize while using software rendering or a slow
presentation path. It also notes that WebKitGTK masks useful renderer
identification, so a successful WebGL context is not proof of hardware
acceleration. It recommends a non-WebGL fallback and suggests allowing users
to switch renderers. This variability motivated the earlier opt-in decision.
The approved default now keeps that fallback while accepting WebKitGTK's
performance uncertainty; manual Wayland validation remains a release gate.

## Performance uncertainty and manual comparison plan

The xterm project's historical release material reports large WebGL wins for
specific older benchmark environments and workloads. Those figures are not a
measurement of this app, its current xterm version, its WebKitGTK build, or
interactive OpenCode TUI traffic. They should not be transferred as a promise
of a significant improvement here.

No representative benchmark was run. The default change does not assert a speed
improvement. Compare the actual application on Wayland with the WebGL renderer
and the fallback DOM renderer, using identical terminal dimensions, font, session
type, and workload. To compare modes, temporarily simulate WebGL initialization
failure in a development build or use a dedicated developer-only override; do not
restore an undocumented production setting:

1. Start the app with `cd app && npm run tauri:dev`.
2. Open a Workspace terminal, a Quick Request terminal, and a tool terminal;
   verify each attempts WebGL and remains attached.
3. Exercise normal interactive use and a repeatable high-output task (for
   example, the same build/log command in the same kind of repository). Note
   perceived output-to-display delay, input responsiveness, scrolling, resize,
   context-loss/fallback behavior, and whether the session remains attached.
4. Exercise the DOM fallback in the development build, close/reopen views, and
   compare more than one live terminal. Verify a context-loss fallback does not
   detach the PTY or lose input/output.
5. Record machine/GPU and driver, Wayland compositor, WebKitGTK version, terminal
   size/font, workload, and actual measurements. A WebGL context alone is not
   evidence of GPU acceleration; Tauri warns Linux may use a software/slow path.

This is a comparison protocol, not a synthetic benchmark. Browser smoke checks do
not establish native WebKitGTK renderer availability or performance. Project
policy keeps native terminal/render acceptance manual on Wayland. No performance
result is available yet.

## Safe integration requirements if revisited

1. Attempt WebGL by default; keep the DOM renderer as the reliable fallback.
2. Attempt WebGL only after `terminal.open`; initialization failure must not
   block PTY attachment, replay, input, or resize.
3. Dispose the WebGL context-loss subscription on terminal teardown. xterm's
   addon manager disposes loaded addons with the terminal; on context loss,
   dispose WebGL directly so xterm can use its default renderer again.
4. Preserve session IDs, input routing, XTGETTCAP handling, output replay,
   fit/resize, and hide/reopen semantics.
5. Unit tests cover both OpenCode attachment paths, initialization fallback,
   context loss, and addon teardown. They do not replace visual/native
   acceptance on Wayland.
6. Benchmark representative workloads before making a performance claim or
   changing the default.

## Sources

- xterm.js, [Using addons](https://xtermjs.org/docs/guides/using-addons/) —
  public addon loading lifecycle (`Terminal.loadAddon`).
- xterm.js, [5.5.0 release notes](https://github.com/xtermjs/xterm.js/releases/tag/5.5.0)
  — compatible addon versions, including canvas 0.7.0 and WebGL 0.18.0.
- xterm.js, [WebGL addon README](https://github.com/xtermjs/xterm.js/blob/master/addons/addon-webgl/README.md)
  — WebGL2 rendering and context-loss event.
- xterm.js 5.5.0, [WebGL addon implementation](https://github.com/xtermjs/xterm.js/blob/5.5.0/addons/addon-webgl/src/WebglAddon.ts)
  — disposing the addon restores xterm's built-in renderer and handles resize.
- xterm.js, [Remove the canvas renderer PR #5105](https://github.com/xtermjs/xterm.js/pull/5105)
  — canvas renderer removal and recommendation to use DOM or WebGL.
- Tauri v2, [Linux Graphics Issues](https://v2.tauri.app/develop/debug/linux-graphics/)
  — WebKitGTK behavior, WebGL slow paths, masked renderer details, and fallback
  recommendation.
- Tauri v2, [Webview Versions](https://v2.tauri.app/reference/webview-versions/)
  — platform WebView ownership, including system WebKitGTK on Linux.

## Validation

Before the approved default change, focused behavior tests covered the DOM
default, WebGL opt-in, both OpenCode attachment paths, initialization fallback,
context loss, and teardown. Post-approval tests and validation are tracked in the
implementation record above. Tests do not validate native WebGL availability,
visual output, performance, layout, or Wayland behavior; those remain manual. No
performance benchmark was run.
