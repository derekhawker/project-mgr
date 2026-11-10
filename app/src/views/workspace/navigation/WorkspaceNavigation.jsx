import { Index, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon, IconButton } from "@ui-lib";
import { NavigationItem } from "../../../components/NavigationItem.jsx";
import { recordUiDiagnostic } from "../../../lib/uiDiagnostics.js";
import styles from "./WorkspaceNavigation.module.css";

/** Reactive Workspace navigation list; selection remains owned by the app shell. */
export function WorkspaceNavigation(props) {
  onMount(() => recordUiDiagnostic("WorkspaceNavigation", "mount"));
  onCleanup(() => recordUiDiagnostic("WorkspaceNavigation", "dispose"));
  const expandedByWorkspace = new Map();
  const expansionFor = (workspaceId) => {
    if (!expandedByWorkspace.has(workspaceId)) {
      expandedByWorkspace.set(workspaceId, createSignal(true));
    }
    return expandedByWorkspace.get(workspaceId);
  };
  const workspaces = () =>
    (props.data()?.workspaces || []).filter(
      (workspace) =>
        workspace.kind === "regular" && workspace.status === "active",
    );
  const workspaceTickets = (workspaceId) =>
    props.data()?.workspaceTickets?.[workspaceId] || [];
  const workspaceIsCurrent = (workspace) =>
    props.selected()?.id === workspace.id &&
    !workspaceTickets(workspace.id).some((ticket) =>
      props.isTicketCurrent?.(workspace, ticket),
    );
  const flatTickets = () =>
    workspaces()
      .flatMap((workspace) =>
        workspaceTickets(workspace.id).map((ticket) => ({ ...ticket, workspace })),
      )
      .sort(
        (a, b) =>
          b.modifiedAt - a.modifiedAt ||
          a.filename.localeCompare(b.filename) ||
          a.workspace.id.localeCompare(b.workspace.id),
      );
  const ticketRow = (ticket, workspace, mode = "grouped") => (
    <li>
      <NavigationItem
        class={mode === "grouped" ? styles.groupedTicketButton : styles.flatTicketButton}
        current={props.isTicketCurrent?.(workspace(), ticket())}
        onPointerEnter={() => recordUiDiagnostic("WorkspaceNavigation", "ticket-pointer-enter")}
        onPointerLeave={() => recordUiDiagnostic("WorkspaceNavigation", "ticket-pointer-leave")}
        onClick={() => {
          recordUiDiagnostic("WorkspaceNavigation", "ticket-click");
          props.onWork(workspace(), ticket().filename);
        }}
      >
        <Show when={ticket().status === "blocked"}>
          <Icon name="circleX" muted />
        </Show>
        <span class={styles.ticketTitle}>{ticket().title}</span>
      </NavigationItem>
    </li>
  );

  return (
    <ul id="workspace-list" aria-busy={String(props.busy())}>
      <Show
        when={workspaces().length > 0}
        fallback={
          <li class={styles.emptyState}>
            No workspaces yet. Use <strong>New</strong> below to create one.
          </li>
        }
      >
        <Show
          when={props.viewMode() === "grouped"}
          fallback={
            <>
              <Index each={workspaces()}>
                {(workspace) => (
                  <li>
                    <NavigationItem
                      class={styles.flatWorkspaceButton}
                      current={workspaceIsCurrent(workspace())}
                      onPointerEnter={() => recordUiDiagnostic("WorkspaceNavigation", "workspace-pointer-enter")}
                      onPointerLeave={() => recordUiDiagnostic("WorkspaceNavigation", "workspace-pointer-leave")}
                      onClick={() => {
                        recordUiDiagnostic("WorkspaceNavigation", "workspace-click");
                        props.onSelect(workspace());
                      }}
                    >
                      <span class={styles.workspaceName}>{workspace().name}</span>
                    </NavigationItem>
                  </li>
                )}
              </Index>
              <li class={styles.ticketHeading}>
                <h3>Tickets</h3>
              </li>
              <Index each={flatTickets()}>
                {(item) => ticketRow(item, () => item().workspace, "flat")}
              </Index>
            </>
          }
        >
          <Index each={workspaces()}>
            {(workspace) => {
              const tickets = () => workspaceTickets(workspace().id);
              const isExpanded = () => expansionFor(workspace().id)[0]();
              const setExpanded = (value) => expansionFor(workspace().id)[1](value);
              return (
                <li class={styles.workspaceGroup}>
                  <div class={styles.workspaceRow}>
                    <NavigationItem
                      class={styles.workspaceButton}
                      current={workspaceIsCurrent(workspace())}
                      onPointerEnter={() => recordUiDiagnostic("WorkspaceNavigation", "workspace-pointer-enter")}
                      onPointerLeave={() => recordUiDiagnostic("WorkspaceNavigation", "workspace-pointer-leave")}
                      onClick={() => {
                        recordUiDiagnostic("WorkspaceNavigation", "workspace-click");
                        props.onSelect(workspace());
                      }}
                    >
                      <span class={styles.workspaceName}>{workspace().name}</span>
                    </NavigationItem>
                    <Show when={tickets().length > 0}>
                      <IconButton
                        class={styles.workspaceDisclosure}
                        label={`${isExpanded() ? "Collapse" : "Expand"} ${workspace().name} tickets`}
                        aria-expanded={String(isExpanded())}
                        onClick={() => setExpanded((current) => !current)}
                      >
                        <Icon name="chevron" muted />
                      </IconButton>
                    </Show>
                  </div>
                  <Show when={isExpanded() && tickets().length > 0}>
                    <ul class={styles.ticketChildren}>
                      <Index each={tickets()}>
                        {(ticket) => ticketRow(ticket, workspace)}
                      </Index>
                    </ul>
                  </Show>
                </li>
              );
            }}
          </Index>
        </Show>
      </Show>
    </ul>
  );
}
