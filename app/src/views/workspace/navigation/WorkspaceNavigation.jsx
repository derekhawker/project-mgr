import { createEffect, For, Index, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon, IconButton } from "@ui-lib";
import { NavigationItem } from "../../../components/NavigationItem.jsx";
import { TicketSessionIndicator } from "../../../components/TicketSessionIndicator.jsx";
import { recordUiDiagnostic } from "../../../lib/uiDiagnostics.js";
import styles from "./WorkspaceNavigation.module.css";

/** Reactive Workspace navigation list; selection remains owned by the app shell. */
export function WorkspaceNavigation(props) {
  onMount(() => recordUiDiagnostic("WorkspaceNavigation", "mount"));
  onCleanup(() => recordUiDiagnostic("WorkspaceNavigation", "dispose"));
  const expandedByWorkspace = new Map();
  const [contextMenu, setContextMenu] = createSignal(null);
  let contextMenuElement;
  const showContextMenu = (event, workspace, ticket) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, workspace, ticket });
  };
  createEffect(() => {
    if (!contextMenu()) return;
    const dismissOutside = (event) => {
      if (!contextMenuElement?.contains(event.target)) setContextMenu(null);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("contextmenu", dismissOutside, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("contextmenu", dismissOutside, true);
    });
  });
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
  const sharedLabelKeys = () => {
    const owners = new Map();
    for (const workspace of workspaces())
      for (const ticket of workspaceTickets(workspace.id)) {
        if (!ticket.projectLabel) continue;
        const key = ticket.projectLabel.trim().toLowerCase();
        if (!owners.has(key)) owners.set(key, new Set());
        owners.get(key).add(workspace.id);
      }
    return new Set([...owners].filter(([, ids]) => ids.size > 1).map(([key]) => key));
  };
  const sharedLabelGroups = () => {
    const groups = new Map();
    for (const workspace of workspaces())
      for (const ticket of displayedWorkspaceTickets(workspace.id)) {
        const key = ticket.projectLabel?.trim().toLowerCase();
        if (!key || !sharedLabelKeys().has(key)) continue;
        if (!groups.has(key)) groups.set(key, { label: ticket.projectLabel, tickets: [] });
        groups.get(key).tickets.push({ ...ticket, workspace });
      }
    return [...groups.values()]
      .map((group) => ({ ...group, tickets: group.tickets.sort((a, b) => a.title.localeCompare(b.title)) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };
  const displayedWorkspaceTickets = (workspaceId) =>
    workspaceTickets(workspaceId).filter((ticket) =>
      ticket.status === "in_progress" ||
      ticket.status === "blocked" ||
      (ticket.status === "draft" && ticket.hasWorkSession),
    );
  const outstandingTicketCount = (workspaceId) =>
    workspaceTickets(workspaceId).filter((ticket) =>
      ["draft", "in_progress", "blocked"].includes(ticket.status),
    ).length;
  const workspaceIsCurrent = (workspace) =>
    props.selected()?.id === workspace.id &&
    !displayedWorkspaceTickets(workspace.id).some((ticket) =>
      props.isTicketCurrent?.(workspace, ticket),
    );
  const flatTickets = () =>
    workspaces()
      .flatMap((workspace) =>
        displayedWorkspaceTickets(workspace.id).map((ticket) => ({ ...ticket, workspace })),
      )
      .sort(
        (a, b) =>
          b.modifiedAt - a.modifiedAt ||
          a.filename.localeCompare(b.filename) ||
          a.workspace.id.localeCompare(b.workspace.id),
      );
  const ticketRow = (ticket, workspace, mode = "grouped", showWorkspace = false) => (
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
        onContextMenu={(event) => showContextMenu(event, workspace(), ticket())}
      >
        <Show when={ticket().status === "blocked"}>
          <Icon name="circleX" muted />
        </Show>
        <span class={styles.ticketTitleGroup}>
          <TicketSessionIndicator
            ticketStatus={ticket().status}
            hasWorkSession={ticket().hasWorkSession}
            opencodeStatus={ticket().opencodeStatus}
          />
          <span class={styles.ticketTitle}>
            <Show when={showWorkspace}>
              <span class={styles.workspaceBadge} title={workspace().name}>{workspace().name}</span>
              <span class={styles.workspaceBadgeSeparator} aria-hidden="true">·</span>
            </Show>
            {ticket().title}
          </span>
        </span>
      </NavigationItem>
    </li>
  );

  return (
    <>
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
                      <span
                        class={styles.ticketCount}
                        aria-label={`${outstandingTicketCount(workspace().id)} outstanding tickets`}
                        title={`${outstandingTicketCount(workspace().id)} outstanding tickets`}
                      >
                        {outstandingTicketCount(workspace().id)}
                      </span>
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
          <For each={sharedLabelGroups()}>
            {(group) => (
              <li class={styles.ticketHeading}>
                <h3>{group.label}</h3>
                <ul class={styles.ticketChildren}>
                  <For each={group.tickets}>
                    {(item) => ticketRow(() => item, () => item.workspace, "grouped", true)}
                  </For>
                </ul>
              </li>
            )}
          </For>
          <Index each={workspaces()}>
            {(workspace) => {
              const tickets = () => displayedWorkspaceTickets(workspace().id).filter((ticket) =>
                !ticket.projectLabel || !sharedLabelKeys().has(ticket.projectLabel.trim().toLowerCase()),
              );
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
                      <span
                        class={styles.ticketCount}
                        aria-label={`${outstandingTicketCount(workspace().id)} outstanding tickets`}
                        title={`${outstandingTicketCount(workspace().id)} outstanding tickets`}
                      >
                        {outstandingTicketCount(workspace().id)}
                      </span>
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
    <Show when={contextMenu()}>
      {(menu) => (
        <>
          <div ref={contextMenuElement} class={styles.ticketContextMenu} role="menu" style={{ left: `${menu().x}px`, top: `${menu().y}px` }}>
            <button type="button" role="menuitem" onClick={() => {
              props.onChangeLabel(menu().workspace, menu().ticket);
              setContextMenu(null);
            }}>Change label…</button>
          </div>
        </>
      )}
    </Show>
    </>
  );
}
