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
