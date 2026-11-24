import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceNavigationController } from "../src/views/workspace/navigation/workspaceNavigationController.js";
import { createChangeReviewController } from "../src/views/workspace/change-review/changeReviewController.js";

function setup({ workspace = null, quickRequest = null } = {}) {
  const state = {
    data: null,
    navigation: null,
    selected: null,
    busy: true,
    count: null,
    reviews: 0,
  };
  const controller = createWorkspaceNavigationController({
    getSelectedWorkspace: () => workspace,
    getSelectedQuickRequest: () => quickRequest,
    getNavigationData: () => state.data,
    setNavigationData: (data) => {
      state.data = data;
    },
    setWorkspaceNavigation: (value) => {
      state.navigation = value;
    },
    setWorkspaceSelected: (value) => {
      state.selected = value;
    },
    setNavigationBusy: (value) => {
      state.busy = value;
    },
    setSelectedOwnerRepositoryCount: (value) => {
      state.count = value;
    },
    syncChangeReviewAvailability: () => {
      state.reviews += 1;
    },
  });
  return { controller, state };
}

test("navigation updates the selected Workspace and counts verified bindings only", () => {
  const workspace = { id: "w1" };
  const { controller, state } = setup({ workspace });
  const data = {
    workspaceRepositories: [
      { workspaceId: "w1", verificationStatus: "verified" },
      { workspaceId: "w1", verificationStatus: "missing" },
      { workspaceId: "w2", verificationStatus: "verified" },
    ],
  };
  controller.renderNavigation(data);
  assert.equal(state.data, data);
  assert.deepEqual(state.navigation, { data, selected: workspace });
  assert.equal(state.selected, true);
  assert.equal(state.count, 1);
  assert.equal(state.reviews, 1);
  assert.equal(state.busy, false);
});

test("no-selection and Quick Request navigation do not recalculate review count", () => {
  for (const options of [
    {},
    { workspace: { id: "w1" }, quickRequest: { id: "q1" } },
  ]) {
    const { controller, state } = setup(options);
    const data = { workspaceRepositories: [] };
    controller.renderNavigation(data);
    assert.deepEqual(state.navigation, {
      data,
      selected: options.workspace || null,
    });
    assert.equal(state.selected, false);
    assert.equal(state.busy, false);
    assert.equal(state.reviews, 0);
    assert.equal(state.count, null);
  }
});

test("navigation refresh does not desynchronize an open Docs page from its tab", () => {
  const workspace = { id: "w1" };
  const state = { docsVisible: true, docsSelected: true };
  const review = createChangeReviewController({
    getSelectedWorkspace: () => workspace,
    getSelectedOwnerRepositoryCount: () => 1,
    getSelectedQuickRequest: () => null,
    isTicketViewerVisible: () => false,
    getRepositoryToolsOwner: () => null,
    syncRepositoryToolsAvailability: () => {},
    docsController: {
      showTerminal: () => {
        state.docsVisible = false;
        state.docsSelected = false;
      },
    },
    setChangeReviewAvailable: () => {},
    setChangeReviewSelected: () => {},
    setChangeReviewDisabled: () => {},
    setChangeReviewVisible: () => {},
    setChangeReviewSummary: () => {},
    setChangeReviewError: () => {},
    setChangeReviewRepositories: () => {},
    setChangeReviewLoading: () => {},
    setSelectedOwnerVisible: () => {},
  });
  const controller = createWorkspaceNavigationController({
    getSelectedWorkspace: () => workspace,
    getSelectedQuickRequest: () => null,
    setNavigationData: () => {},
    setWorkspaceNavigation: () => {},
    setWorkspaceSelected: () => {},
    setNavigationBusy: () => {},
    setSelectedOwnerRepositoryCount: () => {},
    syncChangeReviewAvailability: review.syncChangeReviewAvailability,
  });

  controller.renderNavigation({
    workspaceRepositories: [
      { workspaceId: workspace.id, verificationStatus: "verified" },
    ],
  });

  assert.equal(state.docsVisible, true);
  assert.equal(state.docsSelected, true);
});
