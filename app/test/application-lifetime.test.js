import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationLifetime } from '../src/application-lifetime.js';

globalThis.self = globalThis;
const runtimeModule = await import('../src/terminal-runtime.js');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// Only external boundaries are doubles: no DOM rendering, PTY, or native window.
// The production owner and real TerminalRuntime register/dispose their resources.
function fixture({ register, unregister } = {}) {
  const events = [];
  const handlers = new Map();
  const timers = new Map();
  const errors = [];
  const commands = [];
  const windowTarget = new EventTarget();
  windowTarget.setInterval = (callback, ms) => {
    assert.equal(ms, 3000);
    timers.set(1, callback);
    return 1;
  };
  windowTarget.clearInterval = (id) => { events.push('clear-poll'); timers.delete(id); };
  const listen = async (event, handler) => {
    events.push(`listen:${event}`);
    handlers.set(event, handler);
    if (register) await register(event);
    return () => { events.push(`unlisten:${event}`); unregister?.(event); };
  };
  const lifetime = createApplicationLifetime({
    render: (_, container) => {
      events.push(`mount:${container}`);
      return () => events.push(`dispose:${container}`);
    },
    listen, windowTarget, onError: (error) => errors.push(error),
  });
  const options = {
    loadTerminalRuntime: async () => runtimeModule,
    terminalOptions: { listenEvent: listen, invoke: (...args) => { commands.push(args); return Promise.resolve(null); } },
    subscriptions: [['recovery', (message) => events.push(message)]],
    poll: () => events.push('poll'),
  };
  return { lifetime, options, events, errors, timers, handlers, commands, windowTarget };
}

test('one page owner starts once, retains hidden terminals, and releases adapters before reverse-order islands', { timeout: 5000 }, async () => {
  const { lifetime, options, events, timers, handlers, commands, windowTarget } = fixture();
  lifetime.mount(() => {}, 'parent');
  lifetime.mount(() => {}, 'child');
  assert.throws(() => lifetime.mount(() => {}, 'child'), /already mounted/);
  const ready = lifetime.start(options);
  assert.equal(events.at(-1), 'listen:recovery'); // registration begins before main's subsequent command loads
  assert.equal(lifetime.start(options), ready);
  const runtime = await ready;
  assert.equal(runtime.start(), runtime.start());
  assert.equal(events.filter((event) => event.startsWith('listen:')).length, 4);
  assert.equal(timers.size, 1);
  const poll = timers.get(1);
  poll();
  handlers.get('recovery')('recovered');
  // An external terminal/observer fixture establishes only release ownership,
  // not xterm rendering or native lifecycle acceptance.
  runtime.sessions.set('exact-session', {
    terminal: { dispose: () => events.push('dispose:xterm'), focus() {} },
    resizeObserver: { disconnect: () => events.push('disconnect:resize') },
    fit: { fit() {} },
  });
  runtime.attachments.add('exact-session');
  runtime.buffered.push('not-mounted', new Uint8Array([1]));
  runtime.hide('exact-session');
  runtime.reopen('exact-session');
  // Native visibility/window hiding and in-app navigation are not page unload.
  windowTarget.dispatchEvent(new Event('visibilitychange'));
  assert.equal(lifetime.disposed, false);
  assert.equal(runtime.sessions.size, 1);
  const beforeTeardown = events.length;
  windowTarget.dispatchEvent(new Event('pagehide'));
  lifetime.dispose();
  const cleanup = events.slice(beforeTeardown);
  assert.deepEqual([...cleanup].sort(), [
    'clear-poll', 'unlisten:recovery',
    'unlisten:terminal-error', 'unlisten:terminal-exit', 'unlisten:terminal-output',
    'disconnect:resize', 'dispose:xterm', 'dispose:child', 'dispose:parent',
  ].sort());
  assert.deepEqual(cleanup.filter((event) => ['dispose:child', 'dispose:parent'].includes(event)), ['dispose:child', 'dispose:parent']);
  assert.ok(cleanup.indexOf('dispose:xterm') < cleanup.indexOf('dispose:child'));
  assert.equal(timers.size, 0);
  assert.equal(runtime.listenersReady, false);
  assert.equal(runtime.sessions.size, 0);
  assert.equal(runtime.buffered.pending.size, 0);
  assert.equal(runtime.attachments.has('exact-session'), false);
  poll();
  handlers.get('recovery')('late event');
  handlers.get('terminal-output')({ payload: { sessionId: 'late', dataBase64: 'AQ==' } });
  assert.equal(runtime.buffered.pending.size, 0);
  assert.equal(events.length, beforeTeardown + 9);
  assert.deepEqual(commands, []); // No process cleanup, DB/session deletion, or shutdown.
  await assert.rejects(runtime.write('exact-session', 'late'), /disposed/);
  await assert.rejects(runtime.resize('exact-session'), /disposed/);
  assert.deepEqual(commands, []);
  assert.equal(await lifetime.start(options), null); // no restart after teardown
  assert.throws(() => lifetime.mount(() => {}, 'other'), /disposed/);
});

test('pending app unlisten is released after teardown and late terminal import never constructs a runtime', { timeout: 5000 }, async () => {
  const registration = deferred();
  const entered = deferred();
  const imported = deferred();
  const importEntered = deferred();
  const unregistered = deferred();
  const { lifetime, options, events, errors, handlers, timers } = fixture({ register: async (event) => {
    if (event === 'recovery') { entered.resolve(); await registration.promise; }
  }, unregister: () => unregistered.resolve() });
  options.loadTerminalRuntime = () => { importEntered.resolve(); return imported.promise; };
  const ready = lifetime.start(options);
  await Promise.all([entered.promise, importEntered.promise]);
  lifetime.dispose();
  handlers.get('recovery')('ignored');
  registration.resolve();
  imported.resolve(runtimeModule);
  assert.equal(await ready, null);
  await unregistered.promise;
  assert.deepEqual(events, ['listen:recovery', 'clear-poll', 'unlisten:recovery']);
  assert.equal(timers.size, 0);
  assert.deepEqual(errors, []);
});

test('teardown during real runtime subscription removes early and late handles without registering remaining events', { timeout: 5000 }, async () => {
  const registration = deferred();
  const entered = deferred();
  const { lifetime, options, events, timers } = fixture({ register: async (event) => {
    if (event === 'terminal-exit') { entered.resolve(); await registration.promise; }
  } });
  const ready = lifetime.start(options);
  const rejected = assert.rejects(ready, /runtime is disposed/);
  await entered.promise;
  lifetime.dispose();
  assert.ok(events.includes('unlisten:terminal-output'));
  registration.resolve();
  await rejected;
  assert.equal(events.filter((event) => event === 'unlisten:terminal-exit').length, 1);
  assert.equal(events.includes('listen:terminal-error'), false);
  assert.equal(timers.size, 0);
});

test('subscription rejection is reported; disposing before start cannot launch registrations or polling', { timeout: 5000 }, async () => {
  const { lifetime, options, errors } = fixture({ register: () => { throw new Error('event denied'); } });
  await assert.rejects(lifetime.start(options), /event denied/);
  assert.match(String(errors[0]), /event denied/);
  lifetime.dispose();
  const unused = fixture();
  unused.lifetime.dispose();
  assert.equal(await unused.lifetime.start(unused.options), null);
  assert.equal(unused.timers.size, 0);
  assert.deepEqual(unused.events, []);
});
