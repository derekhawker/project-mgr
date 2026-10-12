import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { registerXtGetTcapHandler } from './terminal-protocol.js';
import { createQuickRequestCommands } from './tauri-commands.js';
import './styles.css';

const commands = createQuickRequestCommands(invoke);
const form = document.querySelector('#request-form');
const promptInput = document.querySelector('#request-prompt');
const modelSelect = document.querySelector('#request-model');
const modelDefaultHint = document.querySelector('#model-default-hint');
const submitButton = document.querySelector('#submit-request');
const restoreButton = document.querySelector('#restore-request');
const statusLabel = document.querySelector('#app-status');
const versionLabel = document.querySelector('#version-label');
const directoryLabel = document.querySelector('#directory-label');
const sessionState = document.querySelector('#session-state');
const sessionTabs = document.querySelector('#session-tabs');
const terminalViews = document.querySelector('#terminal-views');
const terminalEmpty = document.querySelector('#terminal-empty');
const hideTerminalButton = document.querySelector('#hide-terminal');

const sessions = new Map();
const pendingOutput = new Map();
let activeSessionId = null;
let terminalWorkflowReady = false;
let modelOptionsLoaded = false;
let requestInProgress = false;
let restoreInProgress = false;
let availableModelReferences = new Set();

function updateRequestControls() {
  submitButton.disabled =
    !terminalWorkflowReady || !modelSelect.value || !availableModelReferences.has(modelSelect.value) || requestInProgress;
  restoreButton.disabled = !terminalWorkflowReady || restoreInProgress;
  modelSelect.disabled = !modelOptionsLoaded || availableModelReferences.size === 0 || requestInProgress;
}

function setTerminalWorkflowReady(ready) {
  terminalWorkflowReady = ready;
  updateRequestControls();
}

function populateModels(info) {
  availableModelReferences = new Set(info.models.map((model) => model.reference));
  modelSelect.replaceChildren(new Option('Choose a model…', ''));
  for (const model of info.models) {
    const option = new Option(`${model.name} · ${model.reference}`, model.reference);
    modelSelect.add(option);
  }
  modelOptionsLoaded = true;

  if (availableModelReferences.has(info.defaultModel)) {
    modelSelect.value = info.defaultModel;
    modelDefaultHint.textContent = `Default from settings: ${info.defaultModel}`;
    setStatus(`New Quick Requests will use the configured model ${info.defaultModel}.`);
  } else if (info.models.length > 0) {
    modelSelect.value = '';
    modelDefaultHint.textContent =
      `Configured default ${info.defaultModel} is unavailable. Choose an enabled model; no OpenCode default will be used.`;
    setStatus(`Configured default model ${info.defaultModel} is unavailable. Choose a model to continue.`, 'error');
  } else {
    modelSelect.value = '';
    modelDefaultHint.textContent =
      `No enabled models are available. Configure an OpenCode provider; the configured default is ${info.defaultModel}.`;
    setStatus('No enabled models are available. Configure an OpenCode provider before starting a request.', 'error');
  }
  updateRequestControls();
}

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function setStatus(message, kind = 'neutral') {
  statusLabel.textContent = message;
  statusLabel.dataset.kind = kind;
}

function setSessionState(message, kind = 'idle') {
  sessionState.className = `session-state ${kind}`;
  sessionState.lastChild.textContent = message;
}

function receiveTerminalOutput({ payload }) {
  const id = payload.sessionId;
  const data = bytesFromBase64(payload.dataBase64);
  const session = sessions.get(id);

  if (session) {
    session.terminal.write(data);
    return;
  }

  const chunks = pendingOutput.get(id) ?? [];
  chunks.push(data);
  pendingOutput.set(id, chunks);
}

function receiveTerminalExit({ payload }) {
  const session = sessions.get(payload.sessionId);
  if (!session) return;

  session.ended = true;
  if (activeSessionId === payload.sessionId) {
    setSessionState('Terminal ended', 'idle');
  }
}

async function selectSession(id) {
  const selected = sessions.get(id);
  if (!selected) return;

  activeSessionId = id;
  terminalEmpty.hidden = true;
  hideTerminalButton.hidden = false;
  for (const [sessionId, session] of sessions) {
    session.view.hidden = sessionId !== id;
    session.tab.classList.toggle('active', sessionId === id);
    session.tab.setAttribute('aria-selected', String(sessionId === id));
  }

  setSessionState(`Session ${id}`, selected.ended ? 'idle' : 'running');
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      selected.fitAddon.fit();
      selected.terminal.focus();
      resolve();
    });
  });
}

function hideActiveTerminal() {
  if (!activeSessionId) return;
  const session = sessions.get(activeSessionId);
  if (session) {
    session.view.hidden = true;
    session.tab.classList.remove('active');
    session.tab.setAttribute('aria-selected', 'false');
  }
  activeSessionId = null;
  terminalEmpty.hidden = false;
  hideTerminalButton.hidden = true;
  setSessionState('Terminal hidden · session continues', 'running');
  setStatus('The terminal view is hidden; select its session tab to reopen it.');
}

async function addSession(info) {
  if (sessions.has(info.sessionId)) {
    await selectSession(info.sessionId);
    return;
  }

  const tab = document.createElement('button');
  tab.className = 'session-tab';
  tab.type = 'button';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  tab.title = info.title;
  tab.textContent = info.title;

  const view = document.createElement('div');
  view.className = 'terminal-view';
  view.hidden = true;
  const host = document.createElement('div');
  host.className = 'terminal-host';
  view.append(host);

  const terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    convertEol: false,
    fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, monospace',
    fontSize: 13,
    scrollback: 5000,
    theme: {
      background: '#111318',
      foreground: '#e5e7eb',
      cursor: '#a7f3d0',
      selectionBackground: '#334155',
    },
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(host);
  terminal.onData((data) => {
    invoke('write_terminal', { sessionId: info.sessionId, data }).catch((error) => {
      setStatus(`Could not send terminal input: ${error}`, 'error');
    });
  });
  registerXtGetTcapHandler(terminal, (response) => {
    invoke('write_terminal', { sessionId: info.sessionId, data: response }).catch((error) => {
      setStatus(`Could not answer an OpenCode terminal capability query: ${error}`, 'error');
    });
  });
  terminal.onResize(({ cols, rows }) => {
    invoke('resize_terminal', { sessionId: info.sessionId, cols, rows }).catch(() => {});
  });

  const session = { ...info, tab, view, terminal, fitAddon, ended: false };
  sessions.set(info.sessionId, session);
  sessionTabs.append(tab);
  terminalViews.append(view);
  terminalEmpty.hidden = true;

  tab.addEventListener('click', () => selectSession(info.sessionId));
  const buffered = pendingOutput.get(info.sessionId) ?? [];
  for (const chunk of buffered) terminal.write(chunk);
  pendingOutput.delete(info.sessionId);
  await selectSession(info.sessionId);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!terminalWorkflowReady) {
    setStatus('Terminal listeners are not ready; request submission is disabled.', 'error');
    return;
  }
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  const model = modelSelect.value;
  if (!availableModelReferences.has(model)) {
    setStatus('Choose an available model before starting a Quick Request.', 'error');
    return;
  }

  requestInProgress = true;
  updateRequestControls();
  submitButton.querySelector('span:last-child').textContent = 'Opening session…';
  setStatus('Starting OpenCode and opening the terminal before sending your prompt…');
  setSessionState('Opening session', 'starting');

  let info;
  try {
    info = await commands.startQuickRequest(prompt, model);
    await addSession(info);
    promptInput.value = '';
    versionLabel.textContent = `OpenCode ${info.serverVersion}`;
    directoryLabel.textContent = info.directory;
    setStatus('The OpenCode session is open. Starting the request now…');
    await commands.sendInitialPrompt(info.sessionId, prompt, model);
    setStatus(`The request is running with ${model}. Inspect the stream and send follow-ups there.`, 'success');
    setSessionState('OpenCode TUI · follow up here', 'running');
  } catch (error) {
    setStatus(
      info
        ? `Session opened, but the first prompt failed: ${error}`
        : `Could not start the Quick Request: ${error}`,
      'error',
    );
    setSessionState(info ? 'Session open · prompt failed' : 'Could not open session', 'idle');
  } finally {
    requestInProgress = false;
    updateRequestControls();
    submitButton.querySelector('span:last-child').textContent = 'Start Quick Request';
  }
});

modelSelect.addEventListener('change', () => {
  updateRequestControls();
  if (modelSelect.value) {
    setStatus(`New Quick Requests will use ${modelSelect.value}.`);
  }
});

restoreButton.addEventListener('click', async () => {
  if (!terminalWorkflowReady) {
    setStatus('Terminal listeners are not ready; session restore is disabled.', 'error');
    return;
  }
  restoreInProgress = true;
  updateRequestControls();
  setStatus('Finding the latest Quick Request and reopening its OpenCode session…');
  setSessionState('Reopening session', 'starting');

  try {
    const info = await commands.restoreLatestQuickRequest();
    await addSession(info);
    versionLabel.textContent = `OpenCode ${info.serverVersion}`;
    directoryLabel.textContent = info.directory;
    setStatus('Previous Quick Request reopened. Its existing history is shown in the OpenCode terminal.', 'success');
    setSessionState('OpenCode TUI · existing history', 'running');
  } catch (error) {
    setStatus(`Could not reopen the latest Quick Request: ${error}`, 'error');
    setSessionState('Could not reopen session', 'idle');
  } finally {
    restoreInProgress = false;
    updateRequestControls();
  }
});

hideTerminalButton.addEventListener('click', hideActiveTerminal);

window.addEventListener('resize', () => {
  const session = activeSessionId && sessions.get(activeSessionId);
  if (session) session.fitAddon.fit();
});

async function initialize() {
  let unlistenOutput;
  try {
    unlistenOutput = await listen('terminal-output', receiveTerminalOutput);
    await listen('terminal-exit', receiveTerminalExit);
  } catch (error) {
    if (unlistenOutput) await unlistenOutput();
    setTerminalWorkflowReady(false);
    setStatus(`Could not subscribe to OpenCode terminal events: ${error}`, 'error');
    return;
  }

  try {
    const info = await commands.prototypeInfo();
    versionLabel.textContent = `OpenCode ${info.version}`;
    directoryLabel.textContent = info.directory;
    populateModels(info);
    setTerminalWorkflowReady(true);
  } catch (error) {
    setTerminalWorkflowReady(false);
    modelOptionsLoaded = false;
    modelSelect.disabled = true;
    versionLabel.textContent = 'OpenCode unavailable';
    setStatus(`OpenCode check failed: ${error}`, 'error');
  }
}

initialize();
