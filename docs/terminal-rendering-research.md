# Interactive terminal renderer research

## Decision

Keep the xterm.js default renderer (DOM) unless the user explicitly enables the
WebGL trial. The app installs `@xterm/xterm` 5.5.0, `@xterm/addon-fit` 0.10.0,
and the compatible `@xterm/addon-webgl` 0.18.0. Both workspace and Quick
Request terminals share `TerminalRuntime`; the opt-in applies consistently to
both. No renderer has been benchmarked in this app, and no performance gain is
claimed.

The trial is controlled with one local-storage value. In the WebView developer
console, run:

```js
localStorage.setItem('opencode-terminal-renderer-trial', 'webgl');
location.reload();
```

New terminal attachments will attempt WebGL. To turn the trial off and restore
the default renderer for subsequently attached terminals, run:

```js
localStorage.removeItem('opencode-terminal-renderer-trial');
location.reload();
```

This is deliberately not a UI setting and is off by default. Existing mounted
terminals retain their renderer until they are disposed; reload/reopen them to
compare. If storage is unavailable or WebGL initialization fails, the runtime
keeps the DOM fallback and reports the fallback through its terminal error
path. Context loss disposes the WebGL addon and returns to xterm's default
renderer. This capability does not establish hardware acceleration or a
performance improvement.

## Evidence from this repository

- `app/package.json` and its lockfile pin xterm 5.5.0 and fit addon 0.10.0.
- `app/src/terminal-runtime.js` constructs `Terminal` in both `attach` and
  `attachExisting`, loads `FitAddon`, opens the terminal, registers input and
  XTGETTCAP handling, replays output, resizes the PTY, and disposes the terminal
  on detach. Both workspace and Quick Request sessions use this runtime.
- WebGL 0.18.0 is now installed but is not loaded unless the explicit trial key
  is present. xterm's built-in renderer remains the default.
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
to switch renderers. This makes unconditional WebGL selection particularly
hard to justify without testing on the actual Wayland/WebKitGTK configurations.

## Performance conclusion and manual comparison plan

The xterm project's historical release material reports large WebGL wins for
specific older benchmark environments and workloads. Those figures are not a
measurement of this app, its current xterm version, its WebKitGTK build, or
interactive OpenCode TUI traffic. They should not be transferred as a promise
of a significant improvement here.

No representative benchmark was run. Do not treat the following manual
comparison as a benchmark until measurements are recorded. Run the actual
application on Wayland in both modes, using identical terminal dimensions,
font, session type, and workload:

1. Start the app with `cd app && npm run tauri:dev`.
2. In the WebView developer console, enable the trial using the command above,
   reload, and open a workspace terminal and a Quick Request terminal.
3. Exercise normal interactive use and a repeatable high-output task (for
   example, the same build/log command in the same kind of repository). Note
   perceived output-to-display delay, input responsiveness, scrolling, resize,
   context-loss/fallback behavior, and whether the session remains attached.
4. Close/reopen views and compare more than one live terminal; then disable the
   trial with the removal command, reload, and repeat the same workload.
5. Record machine/GPU and driver, Wayland compositor, WebKitGTK version, terminal
   size/font, workload, and actual measurements. A WebGL context alone is not
   evidence of GPU acceleration; Tauri warns Linux may use a software/slow path.

This is a comparison protocol, not an automated GUI acceptance test or a
synthetic benchmark. Project policy keeps terminal/render/layout acceptance
manual on Wayland. No performance result is available yet.

## Safe integration requirements if revisited

1. Keep the DOM renderer as the reliable default and fallback.
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

Focused behavior tests cover the DOM default, WebGL opt-in, both OpenCode
attachment paths, initialization fallback, context loss, and teardown. These
tests do not validate native WebGL availability, visual output, performance,
layout, or Wayland behavior; those remain manual. No performance benchmark was
run.
