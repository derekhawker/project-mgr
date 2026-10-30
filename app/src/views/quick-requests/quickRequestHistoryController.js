import { filterQuickRequests } from "./quickRequestSearch.js";

export function createQuickRequestHistoryController(deps) {
  const {
    invoke,
    listQuickRequests,
    restoreQuickRequest,
    deleteQuickRequest,
    getHistoryQuery,
    getNavigationData,
    getSelectedQuickRequest,
    isQuickRequestVisible = () => true,
    selectQuickRequest,
    showSession,
    forgetDeletedQuickRequestTerminal,
    confirm,
    setAppNotice,
    formatWorkspaceError,
    setRecentQuickRequests,
    setAllQuickRequests,
    refreshNavigation,
    clearSelectedRequest,
    showHistoryDestination,
    setOwnerStatus,
  } = deps;
  let openGeneration = 0;

  async function refreshRequests(history = false) {
    const records = await listQuickRequests(invoke, history);
    const query = history ? getHistoryQuery().trim() : "";
    const filtered = history ? filterQuickRequests(records, query) : records;
    (history ? setAllQuickRequests : setRecentQuickRequests)(filtered);
  }

  async function openQuickRequestRecord(record) {
    const generation = ++openGeneration;
    const navigation = getNavigationData();
    const workspace = navigation.workspaces.find(
      (entry) => entry.id === record.task.workspaceId,
    ) || {
      id: record.task.workspaceId,
      name: "Quick Requests",
      kind: "quick_requests",
      status: "active",
    };
    selectQuickRequest(record.task, workspace, navigation, {
      deferRestore: true,
    });
    setOwnerStatus?.("Loading Quick Request…");
    const isCurrent = () =>
      generation === openGeneration &&
      getSelectedQuickRequest()?.id === record.task.id &&
      isQuickRequestVisible();
    try {
      const restored = await restoreQuickRequest(invoke, record.task.id);
      if (!isCurrent()) return;
      if (!restored.session?.openCodeSessionId)
        throw new Error("Quick Request has no associated session.");
      await showSession(restored.session.openCodeSessionId);
      if (isCurrent()) setOwnerStatus?.("");
    } catch (error) {
      if (isCurrent()) {
        const message = formatWorkspaceError("Open Quick Request", error);
        setOwnerStatus?.(message);
        setAppNotice(message);
      }
    }
  }

  async function deleteQuickRequestRecord(record, history) {
    if (
      !confirm(
        "Delete this Quick Request from the app? Its attached terminal will close, but the OpenCode conversation will remain in OpenCode.",
      )
    )
      return;
    try {
      await deleteQuickRequest(invoke, record.task.id);
      const sessionId = record.session?.openCodeSessionId;
      if (sessionId) await forgetDeletedQuickRequestTerminal(sessionId);
      if (getSelectedQuickRequest()?.id === record.task.id)
        clearSelectedRequest();
      await refreshRequests(false);
      if (history) await refreshRequests(true);
      await refreshNavigation();
    } catch (error) {
      setAppNotice(formatWorkspaceError("Delete Quick Request", error));
    }
  }

  async function deleteQuickRequestRecords(ids) {
    const selected = new Set(ids);
    const records = (await listQuickRequests(invoke, true)).filter(({ task }) =>
      selected.has(task.id),
    );
    if (
      !records.length ||
      !confirm(
        `Delete ${records.length} selected Quick Request${records.length === 1 ? "" : "s"} from the app? Their attached terminals will close, but the OpenCode conversations will remain in OpenCode.`,
      )
    )
      return;
    try {
      for (const record of records) {
        await deleteQuickRequest(invoke, record.task.id);
        const sessionId = record.session?.openCodeSessionId;
        if (sessionId) await forgetDeletedQuickRequestTerminal(sessionId);
        if (getSelectedQuickRequest()?.id === record.task.id)
          clearSelectedRequest();
      }
      await refreshRequests(false);
      await refreshRequests(true);
      await refreshNavigation();
    } catch (error) {
      setAppNotice(formatWorkspaceError("Delete Quick Requests", error));
    }
  }

  async function showQuickRequestList() {
    await refreshRequests(true);
    showHistoryDestination();
  }
  return {
    refreshRequests,
    openQuickRequestRecord,
    deleteQuickRequestRecord,
    deleteQuickRequestRecords,
    showQuickRequestList,
  };
}
