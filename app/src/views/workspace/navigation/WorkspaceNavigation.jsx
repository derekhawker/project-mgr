import {
  createEffect,
  For,
  Index,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { ActionMenuItem, Icon, IconButton } from "@ui-lib";
import { NavigationItem } from "../../../components/NavigationItem.jsx";
import { TicketSessionIndicator } from "../../../components/TicketSessionIndicator.jsx";
import { recordUiDiagnostic } from "../../../lib/uiDiagnostics.js";
import { groupTicketsByLabel, labelColorIndex } from "./ticketSidebarGroups.js";
import { WorkspaceTag } from "./WorkspaceTag.jsx";
import styles from "./WorkspaceNavigation.module.css";

/** Reactive Workspace navigation list; selection remains owned by the app shell. */
export function WorkspaceNavigation(props) {
  onMount(() => recordUiDiagnostic("WorkspaceNavigation", "mount"));
  onCleanup(() => recordUiDiagnostic("WorkspaceNavigation", "dispose"));
  const expandedByLabel = new Map();
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
  const expansionFor = (labelKey) => {
    if (!expandedByLabel.has(labelKey)) {
      expandedByLabel.set(labelKey, createSignal(true));
    }
    return expandedByLabel.get(labelKey);
  };
  const regularWorkspaces = () =>
    (props.data()?.workspaces || []).filter(
      (workspace) => workspace.kind === "regular",
    );
  const recentWorkspaces = () =>
    regularWorkspaces().filter((workspace) => workspace.status === "active");
  const workspaceTickets = (workspaceId) =>
    props.data()?.workspaceTickets?.[workspaceId] || [];
  const recentWorkspaceTickets = (workspaceId) =>
    workspaceTickets(workspaceId).filter(
      (ticket) =>
        !ticket.archived &&
        (ticket.status === "in_progress" ||
          ticket.status === "blocked" ||
          (ticket.status === "draft" && ticket.hasWorkSession)),
    );
  const labelGroups = () =>
    groupTicketsByLabel(regularWorkspaces(), workspaceTickets);
  const flatTickets = () =>
    recentWorkspaces()
      .flatMap((workspace) =>
        recentWorkspaceTickets(workspace.id).map((ticket) => ({
          ...ticket,
          workspace,
        })),
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
        class={
          mode === "grouped"
            ? styles.groupedTicketButton
            : styles.flatTicketButton
        }
        current={props.isTicketCurrent?.(workspace(), ticket())}
        onPointerEnter={() =>
          recordUiDiagnostic("WorkspaceNavigation", "ticket-pointer-enter")
        }
        onPointerLeave={() =>
          recordUiDiagnostic("WorkspaceNavigation", "ticket-pointer-leave")
        }
        onClick={() => {
          recordUiDiagnostic("WorkspaceNavigation", "ticket-click");
          if (
            mode === "grouped" &&
            (ticket().archived ||
              ["done", "cancelled"].includes(ticket().status))
          )
            props.onSelectTicket(workspace(), ticket());
          else props.onWork(workspace(), ticket().filename);
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
          <span class={styles.ticketTitle}>{ticket().title}</span>
        </span>
      </NavigationItem>
      <WorkspaceTag
        label={
          props.viewMode() === "workspaces"
            ? workspace().name
            : ticket().projectLabel || workspace().name
        }
        colorIndex={labelColorIndex(ticket().projectLabel || workspace().name)}
        workspaceName={workspace().name}
        onClick={() => props.onSelect(workspace())}
      />
    </li>
  );

  return (
    <>
      <div
        id="ticket-sidebar-list"
        role="tabpanel"
        aria-labelledby={
          props.viewMode() === "workspaces"
            ? "ticket-sidebar-workspaces"
            : "ticket-sidebar-recent"
        }
        aria-busy={String(props.busy())}
      >
        <ul id="workspace-list">
          <Show
            when={regularWorkspaces().length > 0}
            fallback={
              <li class={styles.emptyState}>
                No workspaces yet. Use <strong>New</strong> below to create one.
              </li>
            }
          >
            <Show
              when={props.viewMode() === "workspaces"}
              fallback={
                <Show
                  when={flatTickets().length > 0}
                  fallback={
                    <li class={styles.emptyState}>No recent tickets.</li>
                  }
                >
                  <Index each={flatTickets()}>
                    {(item) => ticketRow(item, () => item().workspace, "flat")}
                  </Index>
                </Show>
              }
            >
              <Show
                when={labelGroups().length > 0}
                fallback={<li class={styles.emptyState}>No tickets yet.</li>}
              >
                <For each={labelGroups()}>
                  {(group) => (
                    <li class={styles.labelGroup}>
                      <div class={styles.labelGroupRow}>
                        <NavigationItem
                          class={styles.labelGroupButton}
                          style={{
                            "--ticket-label-color": `var(--ticket-label-${labelColorIndex(group.label)})`,
                          }}
                          onClick={() =>
                            props.onSelectTicket(
                              group.tickets[0].workspace,
                              group.tickets[0].ticket,
                            )
                          }
                        >
                          <span class={styles.labelText}>{group.label}</span>
                          <span class={styles.ticketCount}>
                            {group.tickets.length}
                          </span>
                        </NavigationItem>
                        <IconButton
                          class={styles.labelDisclosure}
                          label={`${expansionFor(group.key)[0]() ? "Collapse" : "Expand"} ${group.label} tickets`}
                          aria-expanded={String(expansionFor(group.key)[0]())}
                          onClick={() =>
                            expansionFor(group.key)[1]((value) => !value)
                          }
                        >
                          <Icon name="chevron" muted />
                        </IconButton>
                      </div>
                      <Show when={expansionFor(group.key)[0]()}>
                        <ul class={styles.ticketChildren}>
                          <For each={group.tickets}>
                            {(item) =>
                              ticketRow(
                                () => item.ticket,
                                () => item.workspace,
                                "grouped",
                              )
                            }
                          </For>
                        </ul>
                      </Show>
                    </li>
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </ul>
      </div>
      <Show when={contextMenu()}>
        {(menu) => (
          <>
            <div
              ref={contextMenuElement}
              class={styles.ticketContextMenu}
              role="menu"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <ActionMenuItem
                role="menuitem"
                onClick={() => {
                  props.onChangeLabel(menu().workspace, menu().ticket);
                  setContextMenu(null);
                }}
              >
                Change label…
              </ActionMenuItem>
            </div>
          </>
        )}
      </Show>
    </>
  );
}
