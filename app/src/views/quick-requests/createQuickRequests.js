import { createSignal } from "solid-js";
import { createQuickRequestHistoryController } from "./quickRequestHistoryController.js";
import { QuickRequestList } from "./QuickRequestList.jsx";
import { QuickRequestHistoryPage } from "./QuickRequestHistoryPage.jsx";
import { QuickRequestHistoryButton } from "./QuickRequestHistoryButton.jsx";
import {
  listQuickRequests,
  restoreQuickRequest,
  deleteQuickRequest,
  formatWorkspaceError,
} from "../../services/shell.js";

// Recent navigation and the full list share one controller and selection. Their
// lifetime is the page lifetime, not the selected destination's lifetime.
export function createQuickRequests({
  invoke,
  selection,
  getNavigationData,
  selectQuickRequest,
  showSession,
  forgetDeletedQuickRequestTerminal,
  confirm,
  setAppNotice,
  setOwnerStatus,
  setError,
  refreshNavigation,
  openNewWork,
  destination,
}) {
  const [recentQuickRequests, setRecentQuickRequests] = createSignal([]);
  const [allQuickRequests, setAllQuickRequests] = createSignal([]);
  let historyQuery = "";
  const controller = createQuickRequestHistoryController({
    invoke,
    listQuickRequests,
    restoreQuickRequest,
    deleteQuickRequest,
    getHistoryQuery: () => historyQuery,
    getNavigationData,
    getSelectedQuickRequest: selection.selectedQuickRequest,
    isQuickRequestVisible: destination.isQuickRequestVisible,
    selectQuickRequest,
    showSession,
    forgetDeletedQuickRequestTerminal,
    confirm,
    setAppNotice,
    setOwnerStatus,
    formatWorkspaceError,
    setRecentQuickRequests,
    setAllQuickRequests,
    refreshNavigation,
    clearSelectedRequest: destination.clearSelectedRequest,
    showHistoryDestination: destination.showHistory,
  });
  const {
    refreshRequests,
    openQuickRequestRecord,
    deleteQuickRequestRecord,
    deleteQuickRequestRecords,
    showQuickRequestList,
  } = controller;

  return {
    refreshRequests,
    historyButton: () =>
      QuickRequestHistoryButton({
        onShow: () => {
          void showQuickRequestList().catch((error) => setError(String(error)));
        },
      }),
    recentList: () =>
      QuickRequestList({
        records: recentQuickRequests,
        history: () => false,
        query: () => "",
        selectedId: selection.selectedId,
        onOpen: (record) => void openQuickRequestRecord(record),
        onDelete: (record) => void deleteQuickRequestRecord(record, false),
      }),
    historyPage: () =>
      QuickRequestHistoryPage({
        visible: destination.visible,
        records: allQuickRequests,
        selectedId: selection.selectedId,
        onNew: () => openNewWork("quick_request"),
        onSearch: (query) => {
          historyQuery = query;
          void refreshRequests(true).catch((error) =>
            setAppNotice(formatWorkspaceError("Search Quick Requests", error)),
          );
        },
        onOpen: (record) => void openQuickRequestRecord(record),
        onDelete: (record) => void deleteQuickRequestRecord(record, true),
        onDeleteMany: deleteQuickRequestRecords,
      }),
  };
}
