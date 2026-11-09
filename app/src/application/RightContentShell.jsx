import { Show } from "solid-js";
import { PageMasthead } from "../components/PageMasthead.jsx";
import { WorkspaceTicketViewer } from "../views/workbench/WorkspaceTicketViewer.jsx";

export function RightContentShell(props) {
  return (
    <div
      id="right-content"
      class="right-content"
      classList={{
        "owner-active": props.ownerActive(),
        "quick-request-terminal-page": props.quickRequestTerminalPage(),
      }}
    >
      <Show when={props.quickRequestTerminalPage()}>
        <PageMasthead
          type="Quick Request"
          name={props.quickRequestName()}
          id="quick-request-title"
          flush
        />
      </Show>
      {props.changeReview?.()}
      {props.quickRequestHistory?.()}
      {props.directoriesPage?.()}
      {props.portsPage?.()}
      {props.noSelection?.()}
      <Show when={props.ticketViewerVisible()}>
        <WorkspaceTicketViewer {...props.ticketViewerProps} />
      </Show>
      {props.docsPane?.()}
      {props.workspaceOwnerPanel?.()}
    </div>
  );
}
