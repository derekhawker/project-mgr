import { invoke } from '@tauri-apps/api/core';
import { loadApplicationShell } from './shell.js';
import './styles.css';

const connectionStatus = document.querySelector('#connection-status');
const connectionIndicator = document.querySelector('#connection-indicator');
const commandResult = document.querySelector('#command-result');
const appVersion = document.querySelector('#app-version');

void loadApplicationShell({
  invoke,
  connectionStatus,
  connectionIndicator,
  commandResult,
  appVersion,
});
