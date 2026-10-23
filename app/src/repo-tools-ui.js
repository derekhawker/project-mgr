import { invokeCommand } from './command-contract.js';

export function listRepositoryTools(invoke, ownerType, ownerId) {
  return invokeCommand(invoke, 'repo_tools_list', { request: { ownerType, ownerId } });
}

export function startRepositoryTool(invoke, ownerType, ownerId, repositoryId, kind, name = '') {
  return invokeCommand(invoke, 'repo_tool_terminal_start', {
    request: { ownerType, ownerId, repositoryId, kind, name },
  });
}

export function startWorkbenchShell(invoke, ownerType, ownerId) {
  return invokeCommand(invoke, 'workbench_shell_terminal_start', {
    request: { ownerType, ownerId },
  });
}

export function launchWorkbenchOsHandoff(invoke, ownerType, ownerId, action) {
  return invokeCommand(invoke, 'workbench_os_handoff', {
    request: { ownerType, ownerId, action },
  });
}

export function repoToolTerminalCommand(invoke, operation, payload) {
  if (operation === 'write') return invokeCommand(invoke, 'repo_tool_terminal_write', payload);
  if (operation === 'resize') return invokeCommand(invoke, 'repo_tool_terminal_resize', payload);
  if (operation === 'replay') return invokeCommand(invoke, 'repo_tool_terminal_replay', payload);
  if (operation === 'cleanup') return invokeCommand(invoke, 'repo_tool_terminal_cleanup', payload);
  throw new Error(`Unknown repository terminal operation: ${operation}`);
}

export function renderRepositoryTools(menu, groups, { onRun, onInstall, onHandoff } = {}) {
  menu.replaceChildren();
  const handoff = document.createElement('section');
  handoff.className = 'repo-tools-handoff';
  const heading = document.createElement('h2');
  heading.textContent = 'Open in…';
  handoff.append(heading);
  for (const [action, label] of [['shell', 'Open terminal'], ['idea', 'Open in IntelliJ'], ['folder', 'Show in folder']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => onHandoff?.(action, button, status));
    handoff.append(button);
  }
  const status = document.createElement('p');
  status.className = 'repo-tools-handoff-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  handoff.append(status);
  menu.append(handoff);
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No associated repositories.';
    menu.append(empty);
    return;
  }
  const repositories = document.createElement('div');
  repositories.className = 'repo-tools-repositories';
  for (const repository of groups) {
    const group = document.createElement('section');
    group.className = 'repo-tools-group';
    const heading = document.createElement('h2');
    heading.textContent = repository.name;
    group.append(heading);
    if (repository.npmInstallNeeded) {
      const status = document.createElement('p');
      status.textContent = 'Dependencies missing · npm install';
      const install = document.createElement('button');
      install.type = 'button'; install.textContent = 'Run npm install';
      install.disabled = true;
      status.setAttribute('role', 'status');
      group.append(status, install);
      onInstall?.(repository, install, status);
    }
    for (const [kind, names] of [['npm_script', repository.packageScripts], ['make_target', repository.makeTargets]]) {
      if (!names.length) continue;
      const title = document.createElement('h3');
      title.textContent = kind === 'npm_script' ? 'package.json' : 'Makefile';
      group.append(title);
      for (const name of names) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = name;
        button.addEventListener('click', () => onRun?.(repository, kind, name));
        group.append(button);
      }
    }
    repositories.append(group);
  }
  menu.append(repositories);
}
