import assert from 'node:assert/strict';
import test from 'node:test';
globalThis.self = globalThis;
const { default: xterm } = await import('@xterm/xterm');
const { registerXtGetTcapHandler } = await import('../src/terminal-protocol.js');
const { TerminalEventBuffer, TerminalAttachmentRouter, TerminalRuntime, resolveTerminalConstructor, isWebglRendererTrialEnabled, WEBGL_TRIAL_STORAGE_KEY } = await import('../src/terminal-runtime.js');
const nullResult = () => Promise.resolve(null);

test('resolves xterm Terminal from the namespace Vite serves for the CommonJS package', () => {
  const Terminal = function Terminal() {};
  assert.equal(resolveTerminalConstructor({ default: { Terminal } }), Terminal);
  assert.equal(resolveTerminalConstructor({ Terminal }), Terminal);
  assert.throws(() => resolveTerminalConstructor({ default: {} }), /did not expose its Terminal constructor/);
});

test('WebGL renderer trial is opt-in through explicit local storage value', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  assert.equal(isWebglRendererTrialEnabled(storage), false);
  storage.setItem(WEBGL_TRIAL_STORAGE_KEY, 'webgl');
  assert.equal(isWebglRendererTrialEnabled(storage), true);
  storage.removeItem(WEBGL_TRIAL_STORAGE_KEY);
  assert.equal(isWebglRendererTrialEnabled(storage), false);
  assert.equal(isWebglRendererTrialEnabled({ getItem() { throw new Error('storage unavailable'); } }), false);
});

test('both OpenCode terminal attachment paths load opt-in WebGL after open and teardown it before terminal disposal', async () => {
  for (const attachPath of ['attach', 'attachExisting']) {
    const lifecycle = [];
    let loseContext;
    const loadedAddons = [];
    const terminal = {
      cols: 80, rows: 24,
      loadAddon(addon) { lifecycle.push(addon.webglTrial ? 'load-webgl' : 'load-fit'); loadedAddons.push(addon); addon.activate?.(this); },
      parser: { registerDcsHandler() { return { dispose() {} }; } },
      open() { lifecycle.push('open'); }, onData() {}, write() {}, focus() {},
      dispose() { lifecycle.push('terminal-dispose'); for (const addon of loadedAddons) addon.dispose(); },
    };
    const createWebglAddon = () => {
      let webglDisposed = false;
      return {
        webglTrial: true,
        activate() { lifecycle.push('webgl-activate'); },
        onContextLoss(callback) { loseContext = callback; return { dispose() { lifecycle.push('context-listener-dispose'); } }; },
        dispose() { if (webglDisposed) return; webglDisposed = true; lifecycle.push('webgl-dispose'); },
      };
    };
    const runtime = new TerminalRuntime({
      invoke: async (command) => /_(?:attach|replay)$/.test(command) ? { replay: [] } : null, rendererTrialEnabled: () => true,
      terminalFactory: () => terminal, fitAddonFactory: () => ({ fit() {}, dispose() {} }),
      webglAddonFactory: createWebglAddon,
    });
    runtime.listenersReady = true;
    if (attachPath === 'attach') await runtime.attach('ses_trial', '/workspace/repo', {});
    else await runtime.attachExisting('ses_trial', {});
    assert.ok(lifecycle.indexOf('open') < lifecycle.indexOf('load-webgl'), `${attachPath} opens xterm before WebGL`);
    assert.equal(runtime.sessions.get('ses_trial').terminal, terminal);
    runtime.dispose();
    assert.ok(lifecycle.indexOf('terminal-dispose') < lifecycle.indexOf('webgl-dispose'), `${attachPath} lets xterm dispose its loaded addon`);
    assert.equal(lifecycle.filter((event) => event === 'webgl-dispose').length, 1);

    // Context-loss disposal also has an explicit fallback cleanup path.
    if (attachPath === 'attachExisting') {
      const errors = [];
      const fallbackRuntime = new TerminalRuntime({ invoke: async (command) => /_(?:attach|replay)$/.test(command) ? { replay: [] } : null, rendererTrialEnabled: () => true,
        onError: (error) => errors.push(error), terminalFactory: () => terminal,
        fitAddonFactory: () => ({ fit() {}, dispose() {} }), webglAddonFactory: createWebglAddon });
      fallbackRuntime.listenersReady = true;
      await fallbackRuntime.attachExisting('ses_loss', {});
      loseContext();
      assert.equal(fallbackRuntime.sessions.get('ses_loss').webglAddon, null);
      assert.equal(errors[0].operation, 'renderer-context-loss');
      fallbackRuntime.dispose();
      assert.equal(lifecycle.filter((event) => event === 'webgl-dispose').length, 2);
    }
  }
});

test('WebGL initialization failure leaves the terminal attached and reports DOM fallback', async () => {
  const errors = [];
  const terminal = { cols: 80, rows: 24, loadAddon(addon) { if (addon.webglTrial) throw new Error('WebGL2 unavailable'); }, parser: { registerDcsHandler() { return { dispose() {} }; } }, open() {}, onData() {}, write() {}, focus() {}, dispose() {} };
  const runtime = new TerminalRuntime({ invoke: async (command) => /_(?:attach|replay)$/.test(command) ? { replay: [] } : null, onError: (error) => errors.push(error),
    rendererTrialEnabled: () => true, terminalFactory: () => terminal, fitAddonFactory: () => ({ fit() {}, dispose() {} }),
    webglAddonFactory: () => ({ webglTrial: true, dispose() {} }) });
  runtime.listenersReady = true;
  await runtime.attachExisting('ses_fallback', {});
  assert.equal(runtime.sessions.get('ses_fallback').terminal, terminal);
  assert.equal(errors[0].operation, 'renderer-init');
  assert.match(errors[0].message, /using the default renderer/);
  runtime.dispose();
});

test('buffers output before mount and replays it per session', () => {
  const buffer = new TerminalEventBuffer();
  buffer.push('a', Uint8Array.from([1]));
  buffer.push('b', Uint8Array.from([2]));
  buffer.push('a', Uint8Array.from([3]));
  assert.deepEqual(buffer.take('a').map((x) => [...x]), [[1], [3]]);
  assert.deepEqual(buffer.take('b').map((x) => [...x]), [[2]]);
  assert.deepEqual(buffer.take('a'), []);
});

test('bounds pre-mount output and reports dropped events', () => {
  const buffer = new TerminalEventBuffer({ maxEvents: 2, maxBytes: 10 });
  assert.equal(buffer.push('a', Uint8Array.from([1, 2, 3, 4, 5, 6])), 0);
  assert.equal(buffer.push('a', Uint8Array.from([7, 8, 9, 10])), 0);
  assert.equal(buffer.push('a', Uint8Array.from([11])), 1);
  assert.deepEqual(buffer.take('a').map((x) => [...x]), [[7, 8, 9, 10], [11]]);
});

test('reports frontend pre-mount overflow through the user-facing error callback', () => {
  const errors = [];
  const runtime = new TerminalRuntime({ onError: (error) => errors.push(error) });
  runtime.buffered = new TerminalEventBuffer({ maxEvents: 1 });
  runtime.output({ sessionId: 'a', dataBase64: 'AQ==' });
  runtime.output({ sessionId: 'a', dataBase64: 'Ag==' });
  assert.match(errors[0].message, /older output was dropped/);
});

test('attachment router rejects duplicates and permits cleanup', () => {
  const router = new TerminalAttachmentRouter();
  router.add('ses_a');
  assert.throws(() => router.add('ses_a'), /already attached/);
  router.remove('ses_a');
  assert.equal(router.has('ses_a'), false);
});

test('runtime routes input and resize to the exact session and retains hidden views', async () => {
  const calls = [];
  const runtime = new TerminalRuntime({ invoke: (...args) => { calls.push(args); return nullResult(); } });
  const terminal = { cols: 80, rows: 24, focus() {}, onData() {} };
  const fit = { fit() {} };
  runtime.listenersReady = true;
  runtime.sessions.set('a', { terminal, fit, hidden: false, exited: false });
  await runtime.write('a', 'input');
  await runtime.resize('a');
  runtime.hide('a');
  runtime.reopen('a');
  assert.deepEqual(calls, [
    ['opencode_terminal_write', { sessionId: 'a', data: 'input' }],
    ['opencode_terminal_resize', { sessionId: 'a', cols: 80, rows: 24 }],
  ]);
  assert.equal(runtime.sessions.get('a').hidden, false);
});

test('repository tool terminal routes input and resize through its separate process commands', async () => {
  const calls = [];
  const runtime = new TerminalRuntime({ invoke: (...args) => { calls.push(args); return nullResult(); } });
  runtime.sessions.set('repo-tool-1', {
    terminal: { cols: 91, rows: 27, focus() {} }, fit: { fit() {} },
    hidden: false, exited: false, commandPrefix: 'repo_tool_terminal',
  });
  await runtime.write('repo-tool-1', 'make\n');
  await runtime.resize('repo-tool-1');
  assert.deepEqual(calls, [
    ['repo_tool_terminal_write', { terminalId: 'repo-tool-1', data: 'make\n' }],
    ['repo_tool_terminal_resize', { terminalId: 'repo-tool-1', cols: 91, rows: 27 }],
  ]);
});

test('exit marks only its session unavailable for input', async () => {
  const calls = [];
  const runtime = new TerminalRuntime({ invoke: (...args) => { calls.push(args); return nullResult(); } });
  runtime.sessions.set('a', { terminal: {}, fit: {}, exited: false });
  runtime.sessions.set('b', { terminal: {}, fit: {}, exited: false });
  runtime.exit({ sessionId: 'a' });
  await assert.rejects(() => runtime.write('a', 'nope'), /has exited/);
  await runtime.write('b', 'yes');
  assert.deepEqual(calls, [['opencode_terminal_write', { sessionId: 'b', data: 'yes' }]]);
});

test('real installed xterm parser handles XTGETTCAP DCS +q4d73', async () => {
  const { Terminal } = xterm;
  const terminal = new Terminal();
  const writes = [];
  registerXtGetTcapHandler(terminal, (data) => writes.push(data));
  await new Promise((resolve) => terminal.write('\x1bP+q4d73\x1b\\', resolve));
  assert.deepEqual(writes, ['\x1bP0+r4d73\x1b\\']);
});

test('partial listener failure releases earlier subscriptions and leaves terminal actions disabled without retry duplication', async () => {
  const listened = [];
  const unlistened = [];
  const runtime = new TerminalRuntime({ listenEvent: async (event) => {
    listened.push(event);
    if (event === 'terminal-error') throw new Error('denied');
    return () => unlistened.push(event);
  } });
  const ready = runtime.start();
  assert.equal(runtime.start(), ready);
  await assert.rejects(ready, /Could not register terminal event listeners/);
  assert.deepEqual([...unlistened].sort(), ['terminal-exit', 'terminal-output']);
  assert.equal(runtime.listenersReady, false);
  await assert.rejects(() => runtime.attach('a', '/tmp', {}), /listeners are not ready/);
  await assert.rejects(runtime.start(), /disposed/);
  runtime.dispose();
  assert.equal(listened.length, 3);
  assert.equal(unlistened.length, 2);
});
