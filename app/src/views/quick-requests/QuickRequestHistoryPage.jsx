import { createSignal, Show } from "solid-js";
import { Button, Checkbox, Input } from "@ui-lib";
import { AppPageLayout } from "../../components/page/AppPageLayout.jsx";
import { QuickRequestList } from "./QuickRequestList.jsx";
import pageStyles from "./QuickRequestHistoryPage.module.css";
import styles from "../../application/workArea.module.css";

export function QuickRequestHistoryPage(props) {
  const [query, setQuery] = createSignal("");
  const [deleteMode, setDeleteMode] = createSignal(false);
  const [selectedIds, setSelectedIds] = createSignal(new Set());
  const startDelete = (record) => {
    setSelectedIds(new Set([record.task.id]));
    setDeleteMode(true);
  };
  const toggleDelete = (id) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const cancelDelete = () => {
    setDeleteMode(false);
    setSelectedIds(new Set());
  };
  return (
    <section
      id="quick-request-full-list"
      class={`quick-request-full-list ${pageStyles.page} ${styles.quickRequests}`}
      hidden={!props.visible()}
      aria-labelledby="quick-request-full-title"
    >
      <AppPageLayout
        type="Quick Requests"
        name="All"
        id="quick-request-full-title"
      >
        <div class={pageStyles.pageActions}>
          <Button
            id="new-quick-request"
            variant="primary"
            onClick={props.onNew}
          >
            New Quick Request
          </Button>
        </div>
        <label class="visually-hidden" for="quick-request-search">
          Search Quick Requests
        </label>
        <Input
          id="quick-request-search"
          type="search"
          placeholder="Search Quick Requests…"
          autocomplete="off"
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            props.onSearch?.(event.currentTarget.value);
          }}
        />
        <Show when={deleteMode()}>
          <div class={pageStyles.bulkActions}>
            <Button onClick={cancelDelete}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!selectedIds().size}
              onClick={() => {
                void props.onDeleteMany([...selectedIds()]).then(cancelDelete);
              }}
            >
              Delete selected ({selectedIds().size})
            </Button>
          </div>
        </Show>
        <ul class="quick-request-full-items">
          <QuickRequestList
            records={props.records}
            history={() => true}
            query={query}
            selectedId={props.selectedId}
            onOpen={props.onOpen}
            onDelete={startDelete}
            deleteMode={deleteMode}
            selectedDeleteIds={selectedIds}
            onToggleDelete={toggleDelete}
          />
        </ul>
      </AppPageLayout>
    </section>
  );
}
