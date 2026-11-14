import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ActionMenu, ActionMenuItem, Button, ErrorMessage, Icon, IconButton, Switch, Tooltip } from "@ui-lib";
import { AppPageLayout } from "../../../components/page/AppPageLayout.jsx";
import { TicketSessionIndicator } from "../../../components/TicketSessionIndicator.jsx";
import { TicketStatusBadge } from "./TicketStatusBadge.jsx";
import { CreateTicketIdeaModal } from "./CreateTicketIdeaModal.jsx";
import { recordUiDiagnostic } from "../../../lib/uiDiagnostics.js";
import { renderTicketMarkdown, splitTicketFrontmatter } from "./ticketContent.js";
import styles from "./WorkspaceTicketViewer.module.css";
import repositoryToolsStyles from "../repository-tools/RepositoryToolsMenu.module.css";

const statusOrder = { blocked: 0, in_progress: 1, draft: 2 };
const activeSortOptions = [
  ["status", "Status"],
  ["modified", "Recently modified"],
  ["title", "Title"],
];
const archivedSortOptions = [
  ["status", "Status"],
  ["archivedAt", "Archive time"],
  ["title", "Title"],
];
function compareStatus(a, b) {
  const rank = (status) => statusOrder[status] ?? 3;
  return rank(a.status) - rank(b.status) ||
    (rank(a.status) === 3 ? a.status.localeCompare(b.status) : 0) ||
    b.modifiedAt - a.modifiedAt || a.title.localeCompare(b.title);
}
function archivedTimestamp(ticket) {
  const timestamp = Date.parse(ticket.archivedAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : ticket.modifiedAt;
}
function sortedTickets(tickets, sort) {
  return [...tickets].sort((a, b) => {
    if (sort === "modified") return b.modifiedAt - a.modifiedAt || a.title.localeCompare(b.title);
    if (sort === "archivedAt") return archivedTimestamp(b) - archivedTimestamp(a) || a.title.localeCompare(b.title);
    if (sort === "title") return a.title.localeCompare(b.title);
    return compareStatus(a, b);
  });
}
function displayedDate(ticket) {
  const archivedTimestamp = Date.parse(ticket.archivedAt ?? "");
  const time = Number.isFinite(archivedTimestamp) ? archivedTimestamp : ticket.modifiedAt;
  return {
    dateTime: new Date(time).toISOString(),
    label: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(time),
  };
}

/** Workspace ticket browser and selected-ticket reader. */
export function WorkspaceTicketViewer(props) {
  onMount(() => recordUiDiagnostic("WorkspaceTicketViewer", "mount"));
  onCleanup(() => recordUiDiagnostic("WorkspaceTicketViewer", "dispose"));
  const [localArchived, setArchived] = createSignal(false);
  const [activeSort, setActiveSort] = createSignal("status");
  const [archivedSort, setArchivedSort] = createSignal("archivedAt");
  const archived = () => props.archived ? props.archived() : localArchived();
  const sortOptions = () => archived() ? archivedSortOptions : activeSortOptions;
  const sort = () => archived() ? archivedSort() : activeSort();
  const setSort = (value) => archived() ? setArchivedSort(value) : setActiveSort(value);
  const sortLabel = () => sortOptions().find(([value]) => value === sort())?.[1] ?? "Status";
  const selectedModelLabel = () =>
    (props.modelOptions?.() ?? []).find((option) => option.value === props.selectedModel?.())?.label ??
    "Choose an available model";
  const orderedTickets = createMemo(() => sortedTickets(props.tickets(), sort()));
  const selected = createMemo(() =>
    props.tickets().find((ticket) => ticket.filename === props.selectedFilename()),
  );
  const markdown = createMemo(() => {
    const ticket = selected();
    if (!ticket) return null;
    return renderTicketMarkdown(ticket.content, window);
  });
  return (
    <AppPageLayout
      type="Workspace"
      name={props.workspaceName?.()}
      segments={[{ label: "Tickets" }]}
      id="workspace-ticket-title"
      class={styles.page}
      fullWidth
      fill
      fillContent
    >
      <section aria-label="Workspace tickets" class={styles.viewer}>
        <header class={styles.header}>
          <div class={styles.modelControl}>
            <span>Default Model</span>
            <ActionMenu
              label={selectedModelLabel()}
              actionsLabel="Default Model"
              triggerVariant="compact"
              surfaceVariant="neutral"
              disabled={props.modelBusy?.() ?? true}
            >
              <Show when={!props.selectedModel?.()}>
                <ActionMenuItem disabled>Choose an available model</ActionMenuItem>
              </Show>
              <For each={props.modelOptions?.() ?? []}>{(option) =>
                <ActionMenuItem
                  class={styles.menuOption}
                  aria-pressed={props.selectedModel?.() === option.value}
                  onClick={() => props.onModelChange(option.value)}
                >
                  {option.label}
                  <Show when={props.selectedModel?.() === option.value}>
                    <Icon name="check" />
                  </Show>
                </ActionMenuItem>
              }</For>
            </ActionMenu>
          </div>
          <div class={repositoryToolsStyles.control}>
            {props.toolsMenu?.()}
          </div>
          <CreateTicketIdeaModal
            disabled={() => Boolean(props.modelBusy?.() || !props.selectedModel?.())}
            onPropose={props.onProposeTicket}
            onCreate={props.onCreateTicket}
          />
        </header>
        <ErrorMessage message={props.modelError?.()} />
        <ErrorMessage message={props.error()} />
        <Show when={!props.loading()} fallback={<p role="status">Loading tickets…</p>}>
        <div class={styles.columns}>
          <section class={styles.listPane} aria-label="Ticket list">
            <div class={styles.listToolbar}>
              <label class={styles.listScope}>
                <Switch
                  checked={archived()}
                  onChange={(event) => {
                    const next = event.currentTarget.checked;
                    setArchived(next);
                    props.onArchiveChange(next);
                    props.onSelect(null);
                  }}
                />
                <span>Show archived</span>
              </label>
              <div class={styles.listActions}>
                <IconButton
                  label="Refresh tickets"
                  title="Refresh tickets"
                  disabled={props.loading() || props.working?.()}
                  onClick={props.onRefresh}
                >
                  <Icon name="refresh" />
                </IconButton>
                <ActionMenu
                  class={styles.sortMenu}
                  label={`Sort: ${sortLabel()}`}
                  actionsLabel="Sort tickets"
                  triggerVariant="compact"
                  surfaceVariant="neutral"
                >
                  <For each={sortOptions()}>{([value, label]) =>
                    <ActionMenuItem
                      class={styles.menuOption}
                      aria-pressed={sort() === value}
                      onClick={() => setSort(value)}
                    >
                      {label}
                      <Show when={sort() === value}><Icon name="check" /></Show>
                    </ActionMenuItem>
                  }</For>
                </ActionMenu>
              </div>
            </div>
            <ul class={styles.list} role="list" aria-label={archived() ? "Archived tickets" : "Tickets"}>
              <Show when={orderedTickets().length} fallback={<li class={styles.emptyList} role="listitem">No {archived() ? "archived " : "active "}tickets.</li>}>
                <For each={orderedTickets()}>{(ticket) => {
                  const selected = () => props.selectedFilename() === ticket.filename;
                  const date = displayedDate(ticket);
                  return <li role="listitem" classList={{ [styles.selected]: selected() }}>
                    <button
                      class={styles.selectTicket}
                      type="button"
                      aria-label={`Select ticket: ${ticket.title}`}
                      aria-pressed={selected()}
                      onClick={() => props.onSelect(ticket.filename)}
                    >
                      <TicketStatusBadge status={ticket.status} />
                      <span class={styles.ticketTitleGroup}>
                        <TicketSessionIndicator
                          ticketStatus={ticket.status}
                          hasWorkSession={ticket.hasWorkSession}
                          opencodeStatus={ticket.opencodeStatus}
                        />
                        <span class={styles.ticketTitle}>{ticket.title}</span>
                      </span>
                    </button>
                    <div class={styles.actionCell}>
                      <Show when={!archived()} fallback={
                        <Tooltip
                          content={ticket.archivedAt ?? date.dateTime}
                          delay={150}
                          renderTrigger={(tooltipProps) => (
                            <time
                              class={styles.archivedAt}
                              dateTime={date.dateTime}
                              tabIndex="0"
                              aria-label={`Archived ${date.label}`}
                              aria-describedby={tooltipProps["aria-describedby"]}
                              ref={tooltipProps.ref}
                              onMouseEnter={tooltipProps.onMouseEnter}
                              onMouseLeave={tooltipProps.onMouseLeave}
                              onFocus={tooltipProps.onFocus}
                              onBlur={tooltipProps.onBlur}
                              onKeyDown={tooltipProps.onKeyDown}
                            >{date.label}</time>
                          )}
                        />
                      }>
                        <Button
                          variant="compact"
                          class={styles.rowAction}
                          aria-label={`${ticket.hasWorkSession ? "Resume" : "Work"} ticket: ${ticket.title}`}
                          title={`${ticket.hasWorkSession ? "Resume" : "Work"} ticket`}
                          disabled={Boolean(props.working?.() || props.modelBusy?.() || !props.selectedModel?.())}
                          onClick={() => { props.onSelect(ticket.filename); props.onWork?.(ticket.filename); }}
                        >
                          {ticket.hasWorkSession ? "Resume" : "Work"}
                          <Show when={ticket.hasWorkSession}>
                            <Icon name="terminal" muted />
                          </Show>
                        </Button>
                      </Show>
                    </div>
                  </li>;
                }}</For>
              </Show>
            </ul>
          </section>
          <Show when={selected()} fallback={<div class={styles.emptyDetail}>Select a ticket to read it.</div>}>{(ticket) => {
              const fields = createMemo(() => splitTicketFrontmatter(ticket().content).fields.filter(([key]) => key !== "opencode-status"));
              return <article class={styles.detail} aria-label={`Selected ticket: ${ticket().title}`}>
                <div class={styles.markdown} ref={(element) => createEffect(() => { element.innerHTML = markdown() ?? ""; })} />
                <Show when={fields().length}>
                  <section class={styles.frontmatter} aria-label="Ticket metadata">
                    <h4>Ticket metadata</h4>
                    <dl><For each={fields()}>{([key, value]) => <><dt>{key}</dt><dd>{value || "—"}</dd></>}</For></dl>
                  </section>
                </Show>
              </article>;
          }}</Show>
        </div>
        </Show>
      </section>
    </AppPageLayout>
  );
}
