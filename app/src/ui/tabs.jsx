import { For, Show, createUniqueId, onMount } from 'solid-js';
import styles from './tabs.module.css';

/** Controlled, automatic-activation tabs. Each tab is { id, label, panel }. */
export function Tabs(props) {
  const instanceId = `tabs-${createUniqueId()}`;
  let tabButtons = [];
  const tabId = (id) => `${instanceId}-tab-${encodeURIComponent(id)}`;
  const panelId = (id) => `${instanceId}-panel-${encodeURIComponent(id)}`;
  const enabledTabs = () => props.tabs.filter((tab) => !tab.disabled);
  onMount(() => {
    if (import.meta.env.DEV && !props.label && !props.labelledBy) {
      console.warn('Tabs requires a label or labelledBy.');
    }
  });

  function handleKeyDown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const tabs = enabledTabs();
    const forward = props.orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
    const backward = props.orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    if (!tabs.length || ![forward, backward, 'Home', 'End'].includes(event.key)) return;
    const selectedIndex = tabs.findIndex((tab) => tab.id === props.value);
    const current = selectedIndex;
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
        : (current < 0 ? 0 : (current + (event.key === forward ? 1 : -1) + tabs.length) % tabs.length);
    event.preventDefault();
    tabButtons[tabs[next].id]?.focus();
    props.onChange?.(tabs[next].id);
  }

  return <div class={styles.root}>
    <div class={styles.list} classList={{ [styles.vertical]: props.orientation === 'vertical' }} role="tablist" aria-label={props.label} aria-labelledby={props.labelledBy} aria-orientation={props.orientation || 'horizontal'} onKeyDown={handleKeyDown}>
      <For each={props.tabs}>{(tab) =>
        <button ref={(element) => { tabButtons[tab.id] = element; }}
          class={styles.tab} type="button" role="tab" id={tabId(tab.id)}
          aria-controls={panelId(tab.id)} aria-selected={String(props.value === tab.id)}
          tabindex={props.value === tab.id || (!enabledTabs().some((item) => item.id === props.value) && enabledTabs()[0]?.id === tab.id) ? 0 : -1} disabled={tab.disabled}
          onClick={() => props.onChange?.(tab.id)}>
          {tab.label}
        </button>
      }</For>
    </div>
    <For each={props.tabs}>{(tab) =>
      <section class={styles.panel} role="tabpanel" id={panelId(tab.id)} aria-labelledby={tabId(tab.id)}
        tabindex="0" hidden={props.value !== tab.id}>
        <Show when={props.value === tab.id}>{tab.panel}</Show>
      </section>
    }</For>
  </div>;
}
