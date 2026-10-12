export function formatShellResponse(info) {
  if (
    !info ||
    typeof info.appName !== 'string' ||
    typeof info.version !== 'string' ||
    typeof info.status !== 'string' ||
    typeof info.message !== 'string'
  ) {
    throw new TypeError('The Rust core returned an invalid application shell response.');
  }

  return `${info.appName} · ${info.status} · ${info.message}`;
}

export async function loadApplicationShell({
  invoke,
  connectionStatus,
  connectionIndicator,
  commandResult,
  appVersion,
}) {
  try {
    const info = await invoke('app_shell_info');
    commandResult.textContent = formatShellResponse(info);
    appVersion.textContent = `Version ${info.version}`;
    if (info.status === 'error') {
      connectionStatus.textContent = 'Rust core connected; management storage unavailable';
      connectionIndicator.classList.add('has-error');
      return;
    }
    connectionStatus.textContent = 'Connected to the Rust core';
    connectionIndicator.classList.add('is-connected');
  } catch (error) {
    connectionStatus.textContent = 'Could not connect to the Rust core';
    commandResult.textContent = String(error);
    connectionIndicator.classList.add('has-error');
  }
}
