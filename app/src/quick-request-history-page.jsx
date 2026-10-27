import { createSignal } from 'solid-js';
import { Input } from './ui/index.js';
import { QuickRequestHeading } from './quick-request-heading.jsx';
import { QuickRequestList } from './quick-request-list.jsx';
import styles from './work-area.module.css';

export function QuickRequestHistoryPage(props) {
  const [query, setQuery] = createSignal('');
  return <section id="quick-request-full-list" class={`quick-request-full-list ${styles.quickRequests}`} hidden={!props.visible()} aria-labelledby="quick-request-full-title">
    <QuickRequestHeading onNew={props.onNew} />
    <label class="visually-hidden" for="quick-request-search">Search Quick Requests</label><Input id="quick-request-search" type="search" placeholder="Search Quick Requests…" autocomplete="off" onInput={(event) => { setQuery(event.currentTarget.value); props.onSearch?.(event.currentTarget.value); }} />
    <ul class="quick-request-full-items"><QuickRequestList records={props.records} history={() => true} query={query} selectedId={props.selectedId} onOpen={props.onOpen} onDelete={props.onDelete} /></ul>
  </section>;
}
