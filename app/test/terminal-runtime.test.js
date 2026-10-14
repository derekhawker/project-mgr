import assert from 'node:assert/strict';
import test from 'node:test';
globalThis.self = globalThis;
const { default: xterm } = await import('@xterm/xterm');
const { registerXtGetTcapHandler } = await import('../src/terminal-protocol.js');
const { TerminalEventBuffer, TerminalAttachmentRouter, TerminalRuntime } = await import('../src/terminal-runtime.js');
const nullResult = () => Promise.resolve(null);

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

test('listener failure leaves terminal actions disabled', async () => {
  const runtime = new TerminalRuntime({ listenEvent: () => Promise.reject(new Error('denied')) });
  await assert.rejects(() => runtime.start(), /Could not register terminal event listeners/);
  assert.equal(runtime.listenersReady, false);
  await assert.rejects(() => runtime.attach('a', '/tmp', {}), /listeners are not ready/);
});
