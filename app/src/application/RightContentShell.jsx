import { PageMasthead } from "../components/page/PageMasthead.jsx";
import { WorkspaceTicketViewer } from "../views/workspace/tickets/WorkspaceTicketViewer.jsx";
import { RouteOutlet } from "./RouteOutlet.jsx";

export function RightContentShell(props) {
  const ownerSurfaceActive = () =>
    ["workspace-owner", "quick-request"].includes(props.location().destination);
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
      case "workspace-owner":
        return props.workspaceOwnerView?.();
      case "docs":
        return props.docsPane?.();
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
        "owner-active": ownerSurfaceActive(),
        "proposal-mode": props.proposalMode(),
        "quick-request-terminal-page":
          props.location().destination === "quick-request",
      }}
    >
      <RouteOutlet
        location={props.location}
        subscribe={props.subscribe}
        render={renderDestination}
      />
      {/* This live app resource survives route disposal; route views do not. */}
      {props.terminalSurface?.(ownerSurfaceActive)}
    </div>
  );
}
