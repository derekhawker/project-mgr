import { createSignal } from "solid-js";
import { invokeCommand } from "../../services/commandContract.js";
import { SessionTabList } from "./SessionTabList.jsx";
import { PendingInputList } from "./PendingInputList.jsx";
import {
  ownerSessionTabState,
  restoreOwnerSessionTabs,
} from "./sessionTabState.js";
import { createTerminalSurfaceRegistry } from "../../terminal/terminalSurfaceRegistry.js";
import {
  recordSessionReplacement,
  resolveSessionReplacement,
} from "./sessionRestoreUi.js";
import {
  startRepositoryTool,
  startWorkbenchShell,
  repoToolTerminalCommand,
} from "../../services/repoToolsUi.js";
import {
  createKeyedSingleFlight,
  terminalAccessibilityAttributes,
  workspaceSessionTabLabel,
  cleanupTerminal,
  formatWorkspaceError,
  getSessionStatus,
  listPendingInputs,
  reconcileSession,
  sessionStatusLabel,
  listAllPendingInputs,
} from "../../services/shell.js";

// Page-scoped terminal presentation, shared by Workspaces and Quick Requests.
// Navigation only hides surfaces. Explicit close/delete commands remain separate
// from page disposal; Rust retains all process and persisted-session ownership.
export function createWorkbenchSessions({
  invoke,
  appLifetime,
  getRuntime,
  getNavigationData,
  getCatalog,
  selectedOwnerKey,
  selectedQuickRequest,
  proposalSessionId,
  getToolsOwner,
  showOwnerTerminal,
  setOwnerStatus,
  ownerStatus,
  setCommandResultMessage,
  setSessionStatus,
  notice,
}) {
  const terminalSurfaces = createTerminalSurfaceRegistry();
  const [sessionTabEntries, setSessionTabEntries] = createSignal([]);
  const [pendingInputRows, setPendingInputRows] = createSignal([]);
  const [pendingInputMessage, setPendingInputMessage] = createSignal("");
  const openSessions = new Set();
  const sessionOwners = new Map();
  const selectedSessionByOwner = new Map();
  const sessionDirectories = new Map();
  const missingSessionReplacements = new Map();
  const repositoryToolTerminals = new Set();
  const installStarted = new Set();
  const installTerminalKeys = new Map();
  let terminalViews;

  function addSessionTab(entry) {
    setSessionTabEntries((entries) =>
      entries.some((item) => item.sessionId === entry.sessionId)
        ? entries
        : [...entries, entry],
    );
  }
  function removeSessionTab(sessionId) {
    setSessionTabEntries((entries) =>
      entries.filter((entry) => entry.sessionId !== sessionId),
    );
  }
  function updateSessionTab(sessionId, changes) {
    setSessionTabEntries((entries) =>
      entries.map((entry) =>
        entry.sessionId === sessionId ? { ...entry, ...changes } : entry,
      ),
    );
  }
  function releaseInstall(sessionId) {
    const key = installTerminalKeys.get(sessionId);
    if (key) {
      installStarted.delete(key);
      installTerminalKeys.delete(sessionId);
    }
  }
  function createSurface(sessionId) {
    const container = document.createElement("div");
    container.className = "terminal-surface";
    container.id = `terminal-${sessionId}`;
    container.dataset.terminalSession = sessionId;
    Object.entries(terminalAccessibilityAttributes(sessionId)).forEach(
      ([key, value]) => container.setAttribute(key, value),
    );
    terminalViews.append(container);
    terminalSurfaces.register(sessionId, container);
    return container;
  }

  function syncOwnerSessions({ focus = true } = {}) {
    const ownerKey = selectedOwnerKey();
    const hideTabs = Boolean(
      selectedQuickRequest()?.quickRequest &&
      ownerKey === `task:${selectedQuickRequest().id}`,
    );
    const state = ownerSessionTabState(
      sessionTabEntries(),
      ownerKey,
      selectedSessionByOwner.get(ownerKey),
      hideTabs,
    );
    const selectedId = state.selectedId;
    if (selectedId) {
      selectedSessionByOwner.set(ownerKey, selectedId);
      void getRuntime().then((runtime) => {
        if (!appLifetime.disposed) runtime?.select(selectedId, { focus });
      });
    }
    setSessionTabEntries(state.entries);
    if (selectedId && sessionOwners.get(selectedId) === ownerKey)
      terminalSurfaces.show(selectedId);
    else terminalSurfaces.hide();
    return selectedId;
  }

  async function refreshSessionEvidence(sessionId) {
    const ownerKey = selectedOwnerKey();
    try {
      const [status, pending, reconciliation] = await Promise.all([
        getSessionStatus(invoke, sessionId),
        listPendingInputs(invoke, sessionId),
        reconcileSession(invoke, sessionId),
      ]);
      if (ownerKey !== selectedOwnerKey()) return;
      setSessionStatus(sessionStatusLabel(reconciliation?.status || status));
      setPendingInputMessage("");
      setPendingInputRows(
        [...(pending.permissions || []), ...(pending.forms || [])].map(
          (item) => ({
            label: `Input required · ${item.id || item.requestID || "request"}`,
          }),
        ),
      );
    } catch (error) {
      if (ownerKey !== selectedOwnerKey()) return;
      setSessionStatus(`Session status unavailable: ${String(error)}`);
    }
  }

  async function refreshGlobalPendingInputs() {
    try {
      const records = await listAllPendingInputs(invoke);
      if (notice.get().startsWith("Pending input status unavailable:"))
        notice.set("");
      setPendingInputMessage("");
      setPendingInputRows(
        records.flatMap((record) =>
          [...(record.permissions || []), ...(record.forms || [])].map(
            (item) => ({
              sessionId: record.sessionId,
              label: `${record.sessionId} · Input required · ${item.id || item.requestID || "request"}`,
            }),
          ),
        ),
      );
    } catch (error) {
      const text = `Pending input status unavailable: ${String(error)}`;
      setPendingInputRows([]);
      setPendingInputMessage(text);
      notice.set(text);
    }
  }

  async function closeWorkbenchSession(sessionId) {
    if (sessionId === proposalSessionId()) return;
    try {
      if (repositoryToolTerminals.has(sessionId))
        await repoToolTerminalCommand(invoke, "cleanup", {
          terminalId: sessionId,
        });
      else await cleanupTerminal(invoke, sessionId);
    } catch (error) {
      const message = formatWorkspaceError("Close terminal", error);
      setOwnerStatus(message);
      setCommandResultMessage(message);
      return;
    }
    const runtime = await getRuntime();
    if (appLifetime.disposed) return;
    runtime?.forget(sessionId);
    terminalSurfaces.remove(sessionId);
    const ownerKey = sessionOwners.get(sessionId);
    removeSessionTab(sessionId);
    openSessions.delete(sessionId);
    sessionOwners.delete(sessionId);
    repositoryToolTerminals.delete(sessionId);
    releaseInstall(sessionId);
    if (selectedSessionByOwner.get(ownerKey) === sessionId)
      selectedSessionByOwner.delete(ownerKey);
    const selectedId = syncOwnerSessions({ focus: false });
    if (ownerKey === selectedOwnerKey() && !selectedId) setSessionStatus("");
  }

  async function restartSessionTerminal(sessionId) {
    updateSessionTab(sessionId, { restartBusy: true });
    try {
      const container = terminalSurfaces.get(sessionId);
      const directory = sessionDirectories.get(sessionId);
      if (!container || !directory)
        throw new Error("The saved session directory is unavailable.");
      const runtime = await getRuntime();
      await runtime.restart(sessionId, directory, container);
      updateSessionTab(sessionId, { restartHidden: true });
      await refreshSessionEvidence(sessionId);
    } catch (error) {
      setSessionStatus(`Could not restart terminal: ${String(error)}`);
    } finally {
      updateSessionTab(sessionId, { restartBusy: false });
    }
  }

  const showSession = createKeyedSingleFlight(
    async (sessionId, options = {}) => {
      const { proposal = false } = options;
      sessionId = resolveSessionReplacement(
        missingSessionReplacements,
        sessionId,
      );
      const runtime = await getRuntime();
      if (!runtime)
        throw new Error(
          "Terminal runtime is unavailable; see the startup error above.",
        );
      // Resolve the exact persisted owner/directory in Rust before creating xterm.
      const restored = proposal
        ? null
        : await invokeCommand(invoke, "opencode_session_restore", {
            sessionId,
          });
      if (appLifetime.disposed) return;
      const data = getNavigationData();
      if (!proposal && restored?.openCodeSessionId !== sessionId) {
        const replacementId = recordSessionReplacement(
          missingSessionReplacements,
          data,
          sessionId,
          restored,
        );
        return showSession(replacementId, options);
      }
      const owner = restored?.owner;
      const ownerKey = proposal
        ? "proposal"
        : owner?.owner_type && owner?.owner_id
          ? `${owner.owner_type}:${owner.owner_id}`
          : null;
      if (!proposal && ownerKey !== selectedOwnerKey()) return;
      const requestOwner =
        !proposal &&
        owner?.owner_type === "task" &&
        ((selectedQuickRequest()?.id === owner.owner_id &&
          selectedQuickRequest().quickRequest) ||
          data.tasks?.some(
            (task) => task.id === owner.owner_id && task.quickRequest,
          ));
      if (ownerKey) sessionOwners.set(sessionId, ownerKey);
      if (restored?.directory)
        sessionDirectories.set(sessionId, restored.directory);
      if (!openSessions.has(sessionId)) {
        const container = createSurface(sessionId);
        await runtime.attachExisting(sessionId, container);
        if (appLifetime.disposed) return;
        openSessions.add(sessionId);
        if (!requestOwner) {
          const label = proposal
            ? "Proposal"
            : workspaceSessionTabLabel(
                restored,
                data.workspaceSessionContexts,
                getCatalog(),
              ) || "OpenCode";
          addSessionTab({
            sessionId,
            ownerKey: ownerKey || "",
            label,
            closeable: !proposal,
            restartable: !proposal,
            restartHidden: !runtime.isExited(sessionId),
            onSelect: (event) => {
              const focus =
                event?.currentTarget?.getAttribute("role") !== "tab";
              showOwnerTerminal();
              runtime.select(sessionId, { focus });
              selectedSessionByOwner.set(ownerKey, sessionId);
              syncOwnerSessions({ focus });
              if (proposal) setSessionStatus("Proposal session · interactive");
              else void refreshSessionEvidence(sessionId);
            },
            onClose: () => void closeWorkbenchSession(sessionId),
            onRestart: () => void restartSessionTerminal(sessionId),
          });
        }
      } else if (proposal || ownerKey === selectedOwnerKey())
        runtime.select(sessionId);
      if (!proposal && ownerKey !== selectedOwnerKey()) {
        syncOwnerSessions({ focus: false });
        return;
      }
      terminalSurfaces.show(sessionId);
      if (ownerKey) selectedSessionByOwner.set(ownerKey, sessionId);
      if (proposal) setSessionStatus("Proposal session · interactive");
      else await refreshSessionEvidence(sessionId);
      syncOwnerSessions();
    },
  );

  async function restoreTrackedOwnerSession(owner) {
    const ownerKey = `${owner.type}:${owner.id}`;
    const loadingMessage =
      owner.type === "workspace"
        ? "Loading workspace…"
        : "Loading Quick Request…";
    setOwnerStatus(loadingMessage);
    try {
      await restoreOwnerSessionTabs({
        owner,
        sessions: getNavigationData().sessions,
        selectedSessionByOwner,
        openSessions,
        repositoryToolTerminals,
        getTabEntries: sessionTabEntries,
        getSelectedOwnerKey: selectedOwnerKey,
        showSession,
      });
    } catch (error) {
      if (selectedOwnerKey() === ownerKey)
        setOwnerStatus(formatWorkspaceError("Restore tracked session", error));
      return;
    }
    if (selectedOwnerKey() === ownerKey && ownerStatus() === loadingMessage)
      setOwnerStatus("");
  }

  async function forgetSession(
    sessionId,
    ownerKey = sessionOwners.get(sessionId),
  ) {
    const runtime = await getRuntime();
    if (appLifetime.disposed) return false;
    runtime?.forget(sessionId);
    terminalSurfaces.remove(sessionId);
    removeSessionTab(sessionId);
    openSessions.delete(sessionId);
    sessionOwners.delete(sessionId);
    if (ownerKey && selectedSessionByOwner.get(ownerKey) === sessionId)
      selectedSessionByOwner.delete(ownerKey);
    return true;
  }

  async function attachManagedTerminal(started, owner, label) {
    let runtime = null;
    try {
      runtime = await getRuntime();
      if (appLifetime.disposed) return false;
      if (!runtime) throw new Error("Terminal runtime is unavailable.");
      const sessionId = started.terminalId;
      const ownerKey = `${owner.type}:${owner.id}`;
      const container = createSurface(sessionId);
      sessionOwners.set(sessionId, ownerKey);
      sessionDirectories.set(sessionId, started.directory);
      repositoryToolTerminals.add(sessionId);
      showOwnerTerminal();
      await runtime.attachExisting(sessionId, container, "repo_tool_terminal");
      if (appLifetime.disposed) return false;
      openSessions.add(sessionId);
      addSessionTab({
        sessionId,
        ownerKey,
        label,
        closeable: true,
        restartable: false,
        onSelect: (event) => {
          const focus = event?.currentTarget?.getAttribute("role") !== "tab";
          showOwnerTerminal();
          runtime.select(sessionId, { focus });
          selectedSessionByOwner.set(ownerKey, sessionId);
          syncOwnerSessions({ focus });
        },
        onClose: () => void closeWorkbenchSession(sessionId),
      });
      selectedSessionByOwner.set(ownerKey, sessionId);
      syncOwnerSessions();
      return started;
    } catch (error) {
      if (appLifetime.disposed) return false;
      if (started?.terminalId) {
        try {
          await repoToolTerminalCommand(invoke, "cleanup", {
            terminalId: started.terminalId,
          });
        } catch {
          /* Preserve startup error; Rust shutdown remains the final owner. */
        }
        runtime?.forget(started.terminalId);
        terminalSurfaces.remove(started.terminalId);
        repositoryToolTerminals.delete(started.terminalId);
        installTerminalKeys.delete(started.terminalId);
        sessionOwners.delete(started.terminalId);
        openSessions.delete(started.terminalId);
      }
      throw error;
    }
  }

  async function openRepositoryToolTerminal(
    repository,
    kind,
    name = "",
    installKey = null,
  ) {
    const owner = getToolsOwner();
    if (!owner) return false;
    try {
      const started = await startRepositoryTool(
        invoke,
        owner.type,
        owner.id,
        repository.repositoryId,
        kind,
        name,
      );
      if (installKey) installTerminalKeys.set(started.terminalId, installKey);
      return await attachManagedTerminal(
        started,
        owner,
        `${repository.name} · ${started.label}`,
      );
    } catch (error) {
      setSessionStatus(`Could not start ${name || kind}: ${String(error)}`);
      return false;
    }
  }

  async function openWorkbenchShellTerminal(owner) {
    let started = null;
    try {
      started = await startWorkbenchShell(invoke, owner.type, owner.id);
      return await attachManagedTerminal(started, owner, started.label);
    } catch (error) {
      if (
        started?.terminalId &&
        !repositoryToolTerminals.has(started.terminalId)
      ) {
        try {
          await repoToolTerminalCommand(invoke, "cleanup", {
            terminalId: started.terminalId,
          });
        } catch {
          /* Keep the visible startup error. */
        }
      }
      setSessionStatus(`Could not open terminal: ${String(error)}`);
      return false;
    }
  }

  return {
    showSession,
    restoreTrackedOwnerSession,
    syncOwnerSessions,
    openRepositoryToolTerminal,
    openWorkbenchShellTerminal,
    installStarted,
    refreshGlobalPendingInputs,
    hide: () => terminalSurfaces.hide(),
    forgetProposalSession: (sessionId) => forgetSession(sessionId, "proposal"),
    async forgetDeletedQuickRequestTerminal(sessionId) {
      if (await forgetSession(sessionId)) syncOwnerSessions();
    },
    onExit({ sessionId }) {
      releaseInstall(sessionId);
      updateSessionTab(sessionId, { restartHidden: false });
    },
    poll() {
      void refreshGlobalPendingInputs();
      if (openSessions.size) void refreshSessionEvidence([...openSessions][0]);
    },
    setTerminalViews: (element) => {
      terminalViews = element;
    },
    selectedSessionId: () =>
      sessionTabEntries().find((entry) => entry.visible && entry.selected)
        ?.sessionId,
    tabs: () => SessionTabList({ tabs: sessionTabEntries }),
    pendingInputs: () =>
      PendingInputList({
        items: pendingInputRows,
        message: pendingInputMessage,
        onOpen: (sessionId) => {
          showOwnerTerminal();
          void showSession(sessionId);
        },
      }),
  };
}
