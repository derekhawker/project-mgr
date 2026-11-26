import { createComponent, createSignal } from "solid-js";
import styles from "./navigation.module.css";
import { WorkspaceNavigation } from "../views/workspace/navigation/WorkspaceNavigation.jsx";
import { TicketSidebarTabs } from "../views/workspace/navigation/TicketSidebarTabs.jsx";
import { RightContentShell } from "./RightContentShell.jsx";
import { TicketLabelEditor } from "../components/TicketLabelEditor.jsx";
import { TicketWorkWarningModal } from "../components/TicketWorkWarningModal.jsx";

export function ApplicationRoot(props) {
  const [ticketLabelSelection, setTicketLabelSelection] = createSignal(null);
  const newWorkModal = props.newWorkModal();
  return (
    <>
      <main class="shell">
        <div class="workspace-layout">
          <aside class="navigation" aria-label="Workspace navigation">
            <section class="quick-section">
              <div class="quick-section-heading">
                <h3>Quick Requests</h3>
                {props.quickRequestHistoryButton()}
              </div>
              <ul id="quick-request-list" aria-live="polite">
                {props.quickRequestList()}
              </ul>
            </section>
            <TicketSidebarTabs
              value={props.workspaceNavigation.viewMode}
              onChange={props.workspaceNavigation.onViewChange}
            />
            <div class="navigation-scroll">
              <WorkspaceNavigation
                {...props.workspaceNavigation}
                onChangeLabel={(workspace, ticket) =>
                  setTicketLabelSelection({ workspace, ticket })
                }
              />
            </div>
            <div class={styles.destinations}>
              {props.portsNavigationButton()}
              {props.directoriesNavigationButton()}
            </div>
            {props.newWorkMenu()}
          </aside>
          <section class="quick-view" aria-label="Selected work">
            {props.workspaceShell()}
            {props.rightContentProps
              ? createComponent(RightContentShell, props.rightContentProps)
              : props.rightContent?.()}
          </section>
        </div>

        <section class="visually-hidden" aria-labelledby="connection-title">
          {props.applicationStatus()}
        </section>
        {props.appNotice()}
      </main>
      {newWorkModal}
      <TicketLabelEditor
        selection={ticketLabelSelection}
        onClose={() => setTicketLabelSelection(null)}
        onLoadLabels={props.workspaceNavigation.onLoadLabels}
        onApply={(selection, label) =>
          props.workspaceNavigation.onSetTicketLabel(
            selection.workspace,
            selection.ticket.filename,
            label,
          )
        }
      />
      <TicketWorkWarningModal
        warning={props.ticketWorkWarning}
        busy={props.ticketWorkBusy}
        onCancel={props.onTicketWorkWarningCancel}
        onContinue={props.onTicketWorkWarningContinue}
      />
    </>
  );
}
