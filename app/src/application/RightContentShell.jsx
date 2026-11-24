import { PageMasthead } from "../components/page/PageMasthead.jsx";
import { WorkspaceTicketViewer } from "../views/workspace/tickets/WorkspaceTicketViewer.jsx";
import { RouteOutlet } from "./RouteOutlet.jsx";

export function RightContentShell(props) {
  const renderDestination = (location) => {
    switch (location.destination) {
      case "quick-request":
        return (
          <PageMasthead
            type="Quick Request"
            name={props.quickRequestName()}
            id="quick-request-title"
            flush
          />
        );
      case "quick-request-history":
        return props.quickRequestHistory?.();
      case "directories":
        return props.directoriesPage?.();
      case "ports":
        return props.portsPage?.();
      case "change-review":
        return props.changeReview?.();
      case "workspace-tickets":
        return <WorkspaceTicketViewer {...props.ticketViewerProps} />;
      case "docs":
        return props.docsPane?.();
      case "workspace-owner":
        return null;
      case "no-selection":
      default:
        return props.noSelection?.();
    }
  };

  return (
    <div
      id="right-content"
      class="right-content"
      classList={{
        "owner-active": props.ownerActive(),
        "quick-request-terminal-page":
          props.location().destination === "quick-request",
      }}
    >
      <RouteOutlet
        location={props.location}
        subscribe={props.subscribe}
        render={renderDestination}
      />
      {/* App-owned terminal/session presentation survives route disposal. */}
      {props.workspaceOwnerPanel?.()}
    </div>
  );
}
