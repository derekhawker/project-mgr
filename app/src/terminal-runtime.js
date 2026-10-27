import { invokeCommand } from './command-contract.js';
import { listen } from '@tauri-apps/api/event';
import * as xtermModule from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { registerXtGetTcapHandler } from './terminal-protocol.js';
import { repoToolTerminalCommand } from './repo-tools-ui.js';

export function resolveTerminalConstructor(moduleNamespace) {
  // Vite exposes this CommonJS package's exports under `default`; Node may
  // synthesize the named exports directly on the namespace.
  const moduleExports = moduleNamespace?.default ?? moduleNamespace;
  if (typeof moduleExports?.Terminal !== 'function') {
    throw new Error('The xterm package did not expose its Terminal constructor.');
  }
  return moduleExports.Terminal;
}

const Terminal = resolveTerminalConstructor(xtermModule);

const decode = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export const WEBGL_TRIAL_STORAGE_KEY = 'opencode-terminal-renderer-trial';

export function isWebglRendererTrialEnabled(storage) {
  try {
    storage ??= globalThis.localStorage;
    return storage?.getItem(WEBGL_TRIAL_STORAGE_KEY) === 'webgl';
  } catch {
    // Storage may be unavailable in restricted WebViews; keep DOM as default.
    return false;
  }
}

// These small state objects are deliberately independent of xterm and Tauri.
// PTY output may arrive before a terminal is mounted or while its view is
// hidden, so the buffer is keyed by the exact session id.
export class TerminalEventBuffer {
  constructor({ maxEvents = 256, maxBytes = 4 * 1024 * 1024 } = {}) {
    this.pending = new Map();
    this.maxEvents = maxEvents;
    this.maxBytes = maxBytes;
    this.bytes = new Map();
  }
  push(sessionId, bytes) {
    const queue = this.pending.get(sessionId) || [];
    queue.push(bytes);
    let size = (this.bytes.get(sessionId) || 0) + bytes.byteLength;
    let dropped = 0;
    while (queue.length > this.maxEvents || size > this.maxBytes) {
      size -= queue.shift().byteLength;
      dropped += 1;
    }
    this.pending.set(sessionId, queue);
    this.bytes.set(sessionId, size);
    return dropped;
  }
  take(sessionId) { const result = this.pending.get(sessionId) || []; this.pending.delete(sessionId); this.bytes.delete(sessionId); return result; }
}

export class TerminalAttachmentRouter {
  constructor() { this.attached = new Set(); }
  add(sessionId) { if (this.attached.has(sessionId)) throw new Error(`Terminal is already attached: ${sessionId}`); this.attached.add(sessionId); }
  remove(sessionId) { this.attached.delete(sessionId); }
  has(sessionId) { return this.attached.has(sessionId); }
}

export class TerminalRuntime {
  constructor({ invoke, listenEvent = listen, onError = () => {}, onExit = () => {},
    terminalFactory = (options) => new Terminal(options), fitAddonFactory = () => new FitAddon(),
    webglAddonFactory = () => new WebglAddon(), rendererTrialEnabled = isWebglRendererTrialEnabled } = {}) {
    this.invoke = invoke;
    this.listenEvent = listenEvent;
    this.sessions = new Map();
    this.buffered = new TerminalEventBuffer();
    this.attachments = new TerminalAttachmentRouter();
    this.listenersReady = false;
    this.selectedSessionId = null;
    this.onError = onError;
    this.onExit = onExit;
    this.terminalFactory = terminalFactory;
    this.fitAddonFactory = fitAddonFactory;
    this.webglAddonFactory = webglAddonFactory;
    this.rendererTrialEnabled = rendererTrialEnabled;
    this.disposed = false;
    this.unlisteners = [];
    this.startPromise = null;
  }

  start() {
    if (this.disposed) return Promise.reject(new Error('Terminal runtime is disposed.'));
    if (!this.startPromise) this.startPromise = this.registerListeners();
    return this.startPromise;
  }

  async registerListeners() {
    // All subscriptions complete before callers are allowed to enable any
    // session controls. A failed subscription is a hard startup failure.
    try {
      for (const [event, handle] of [
        ['terminal-output', (payload) => this.output(payload)],
        ['terminal-exit', (payload) => this.exit(payload)],
        ['terminal-error', (payload) => this.error(payload)],
      ]) {
        const unlisten = await this.listenEvent(event, ({ payload }) => {
          if (!this.disposed) handle(payload);
        });
        if (this.disposed) {
          unlisten?.();
          throw new Error('Terminal runtime is disposed.');
        }
        this.unlisteners.push(unlisten);
      }
      this.listenersReady = true;
      return this;
    } catch (error) {
      this.dispose();
      throw new Error(`Could not register terminal event listeners: ${String(error)}`);
    }
  }

  // Presentation only: never invoke PTY cleanup, session deletion, or shutdown.
  // Rust owns processes; explicit user close uses the separate command adapter.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.listenersReady = false;
    for (const unlisten of this.unlisteners.splice(0).reverse()) {
      try { unlisten?.(); } catch (error) { console.error(error); }
    }
    for (const sessionId of this.sessions.keys()) {
      try { this.forget(sessionId); } catch (error) { console.error(error); }
    }
    this.buffered.pending.clear();
    this.buffered.bytes.clear();
    this.selectedSessionId = null;
  }

  async attach(sessionId, directory, container) {
    if (!this.listenersReady) throw new Error('Terminal event listeners are not ready.');
    if (this.sessions.has(sessionId)) throw new Error(`Terminal is already attached: ${sessionId}`);
    const terminal = this.terminalFactory({ convertEol: false, cursorBlink: true });
    const fit = this.fitAddonFactory();
    terminal.loadAddon(fit);
    // Register before open/replay: startup queries can be in the buffered data.
    registerXtGetTcapHandler(terminal, (data) => this.write(sessionId, data));
    terminal.onData((data) => this.write(sessionId, data).catch((error) => this.onError({ sessionId, operation: 'write', message: String(error) })));
    terminal.open(container);
    const session = { terminal, fit, container, hidden: false, exited: false, resizeObserver: null, webglAddon: null, webglContextLoss: null };
    this.tryEnableWebglRenderer(sessionId, session);
    fit.fit();
    this.sessions.set(sessionId, session);
    this.selectedSessionId = sessionId;
    this.attachments.add(sessionId);
    const pending = this.buffered.take(sessionId);
    for (const bytes of pending) terminal.write(bytes);
    try {
      const result = await invokeCommand(this.invoke, 'opencode_terminal_attach', { sessionId, directory });
      if (this.disposed) throw new Error('Terminal runtime is disposed.');
      this.replay(sessionId, result);
      await this.resize(sessionId);
      if (this.disposed) throw new Error('Terminal runtime is disposed.');
      if (typeof ResizeObserver !== 'undefined') {
        session.resizeObserver = new ResizeObserver(() => {
          if (!session.hidden) void this.resize(sessionId).catch((error) => this.onError({ sessionId, operation: 'resize', message: String(error) }));
        });
        session.resizeObserver.observe(container);
      }
    } catch (error) {
      this.forget(sessionId);
      throw error;
    }
    terminal.focus();
    return terminal;
  }

  // Rust attaches the PTY before the initial prompt. Mounting is a separate
  // presentation step so the WebView never races that process ownership.
  async attachExisting(sessionId, container, commandPrefix = 'opencode_terminal') {
    if (!this.listenersReady) throw new Error('Terminal event listeners are not ready.');
    if (this.sessions.has(sessionId)) return this.sessions.get(sessionId).terminal;
    const terminal = this.terminalFactory({ convertEol: false, cursorBlink: true });
    const fit = this.fitAddonFactory();
    terminal.loadAddon(fit);
    registerXtGetTcapHandler(terminal, (data) => this.write(sessionId, data));
    terminal.onData((data) => this.write(sessionId, data, commandPrefix).catch((error) => this.onError({ sessionId, operation: 'write', message: String(error) })));
    terminal.open(container);
    const session = { terminal, fit, container, hidden: false, exited: false, resizeObserver: null, commandPrefix, webglAddon: null, webglContextLoss: null };
    this.tryEnableWebglRenderer(sessionId, session);
    fit.fit();
    this.sessions.set(sessionId, session);
    this.selectedSessionId = sessionId;
    this.attachments.add(sessionId);
    for (const bytes of this.buffered.take(sessionId)) terminal.write(bytes);
    try {
      const result = commandPrefix === 'opencode_terminal'
        ? await invokeCommand(this.invoke, 'opencode_terminal_replay', { sessionId })
        : await repoToolTerminalCommand(this.invoke, 'replay', { terminalId: sessionId });
      if (this.disposed) throw new Error('Terminal runtime is disposed.');
      this.replay(sessionId, result);
      await this.resize(sessionId);
      if (this.disposed) throw new Error('Terminal runtime is disposed.');
      if (typeof ResizeObserver !== 'undefined') {
        session.resizeObserver = new ResizeObserver(() => {
          if (!session.hidden) void this.resize(sessionId).catch((error) => this.onError({ sessionId, operation: 'resize', message: String(error) }));
        });
        session.resizeObserver.observe(container);
      }
      terminal.focus();
      return terminal;
    } catch (error) {
      this.forget(sessionId);
      throw error;
    }
  }

  replay(sessionId, result) {
    for (const event of result?.replay || []) {
      if (event.kind === 'output' && event.dataBase64) this.sessions.get(sessionId)?.terminal.write(decode(event.dataBase64));
      if (event.kind === 'error') this.onError(event);
      if (event.kind === 'exit') this.exit({ sessionId });
    }
  }

  tryEnableWebglRenderer(sessionId, session) {
    let addon;
    try {
      if (!this.rendererTrialEnabled()) return;
      addon = this.webglAddonFactory();
      session.terminal.loadAddon(addon);
      session.webglAddon = addon;
      session.webglContextLoss = addon.onContextLoss(() => {
        this.releaseWebglRenderer(session);
        this.onError({ sessionId, operation: 'renderer-context-loss', message: 'WebGL context was lost; the terminal has returned to its default renderer.' });
      });
    } catch (error) {
      try { addon?.dispose(); } catch { /* retain the DOM fallback even if addon cleanup fails */ }
      session.webglAddon = null;
      session.webglContextLoss?.dispose?.();
      session.webglContextLoss = null;
      this.onError({ sessionId, operation: 'renderer-init', message: `WebGL renderer unavailable; using the default renderer: ${String(error)}` });
    }
  }

  releaseWebglRenderer(session) {
    session.webglContextLoss?.dispose?.();
    session.webglContextLoss = null;
    const addon = session.webglAddon;
    session.webglAddon = null;
    addon?.dispose();
  }

  disposeTerminalRenderer(session) {
    session.webglContextLoss?.dispose?.();
    session.webglContextLoss = null;
    try { session.terminal.dispose(); }
    finally { session.webglAddon = null; }
  }

  output(payload) {
    if (this.disposed) return;
    if (!payload || typeof payload.sessionId !== 'string') return;
    const bytes = decode(payload.dataBase64);
    const session = this.sessions.get(payload.sessionId);
    if (session) session.terminal.write(bytes);
    else if (this.buffered.push(payload.sessionId, bytes) > 0) {
      this.onError({ sessionId: payload.sessionId, operation: 'buffer-overflow', message: 'Terminal output arrived before mount faster than it could be buffered; older output was dropped.' });
    }
  }

  exit(payload) {
    if (this.disposed) return;
    if (payload?.sessionId) {
      const session = this.sessions.get(payload.sessionId);
      if (session) session.exited = true;
      this.exited = payload.sessionId;
      this.onExit(payload);
    }
  }

  error(payload) {
    if (this.disposed) return;
    if (payload?.sessionId) this.onError(payload);
  }

  write(sessionId, data, commandPrefix = this.sessions.get(sessionId)?.commandPrefix || 'opencode_terminal') {
    if (this.disposed) return Promise.reject(new Error('Terminal runtime is disposed.'));
    if (this.sessions.get(sessionId)?.exited) return Promise.reject(new Error(`Terminal has exited: ${sessionId}`));
    return commandPrefix === 'opencode_terminal'
      ? invokeCommand(this.invoke, 'opencode_terminal_write', { sessionId, data })
      : repoToolTerminalCommand(this.invoke, 'write', { terminalId: sessionId, data });
  }

  isExited(sessionId) {
    return this.sessions.get(sessionId)?.exited === true;
  }

  async restart(sessionId, directory, container) {
    if (this.disposed) throw new Error('Terminal runtime is disposed.');
    const session = this.sessions.get(sessionId);
    if (session && !session.exited) throw new Error(`Terminal is still running: ${sessionId}`);
    if (session) {
      session.resizeObserver?.disconnect();
      this.disposeTerminalRenderer(session);
      this.sessions.delete(sessionId);
      this.attachments.remove(sessionId);
    }
    if (this.selectedSessionId === sessionId) this.selectedSessionId = null;
    container.replaceChildren();
    this.buffered.take(sessionId);
    await invokeCommand(this.invoke, 'opencode_terminal_restart', { sessionId });
    return this.attachExisting(sessionId, container);
  }

  select(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown terminal session: ${sessionId}`);
    this.selectedSessionId = sessionId;
    session.hidden = false;
    session.fit.fit();
    session.terminal.focus();
    return session.terminal;
  }

  async resize(sessionId) {
    if (this.disposed) throw new Error('Terminal runtime is disposed.');
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown terminal session: ${sessionId}`);
    session.fit.fit();
    const prefix = session.commandPrefix || 'opencode_terminal';
    const payload = prefix === 'opencode_terminal'
      ? { sessionId, cols: session.terminal.cols, rows: session.terminal.rows }
      : { terminalId: sessionId, cols: session.terminal.cols, rows: session.terminal.rows };
    return prefix === 'opencode_terminal'
      ? invokeCommand(this.invoke, 'opencode_terminal_resize', payload)
      : repoToolTerminalCommand(this.invoke, 'resize', payload);
  }

  hide(sessionId) { const session = this.sessions.get(sessionId); if (session) session.hidden = true; return session?.terminal; }
  forget(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.attachments.remove(sessionId);
    this.buffered.take(sessionId);
    if (this.selectedSessionId === sessionId) this.selectedSessionId = null;
    try { session.resizeObserver?.disconnect(); }
    finally {
      this.disposeTerminalRenderer(session);
    }
  }
  reopen(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    session.hidden = false;
    session.fit.fit();
    session.terminal.focus();
    return session.terminal;
  }
}
