import { invokeCommand } from "./commandContract.js";

export function listRepositoryTools(invoke, ownerType, ownerId, ticketFilename) {
  return invokeCommand(invoke, "repo_tools_list", {
    request: { ownerType, ownerId, ...(ticketFilename ? { ticketFilename } : {}) },
  });
}

export function startRepositoryTool(
  invoke,
  ownerType,
  ownerId,
  repositoryId,
  kind,
  name = "",
  ticketFilename,
) {
  return invokeCommand(invoke, "repo_tool_terminal_start", {
    request: { ownerType, ownerId, repositoryId, kind, name, ...(ticketFilename ? { ticketFilename } : {}) },
  });
}

export function startWorkspaceShell(invoke, ownerType, ownerId, ticketFilename) {
  return invokeCommand(invoke, "workbench_shell_terminal_start", {
    request: { ownerType, ownerId, ...(ticketFilename ? { ticketFilename } : {}) },
  });
}

export function launchWorkspaceOsHandoff(invoke, ownerType, ownerId, action, ticketFilename) {
  return invokeCommand(invoke, "workbench_os_handoff", {
    request: { ownerType, ownerId, action, ...(ticketFilename ? { ticketFilename } : {}) },
  });
}

export function repoToolTerminalCommand(invoke, operation, payload) {
  if (operation === "write")
    return invokeCommand(invoke, "repo_tool_terminal_write", payload);
  if (operation === "resize")
    return invokeCommand(invoke, "repo_tool_terminal_resize", payload);
  if (operation === "replay")
    return invokeCommand(invoke, "repo_tool_terminal_replay", payload);
  if (operation === "cleanup")
    return invokeCommand(invoke, "repo_tool_terminal_cleanup", payload);
  throw new Error(`Unknown repository terminal operation: ${operation}`);
}
