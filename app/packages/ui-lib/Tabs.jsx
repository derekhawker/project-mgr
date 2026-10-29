import { For, Show, createUniqueId } from "solid-js";
import { TabList } from "./TabList.jsx";
import { Tab } from "./Tab.jsx";
import styles from "./Tabs.module.css";

/** Controlled, automatic-activation tabs. Each tab is { id, label, panel }. */
export function Tabs(props) {
  const instanceId = `tabs-${createUniqueId()}`;
  const tabId = (id) => `${instanceId}-tab-${encodeURIComponent(id)}`;
  const panelId = (id) => `${instanceId}-panel-${encodeURIComponent(id)}`;

  return (
    <div class={styles.root}>
      <TabList
        value={props.value}
        onChange={props.onChange}
        label={props.label}
        labelledBy={props.labelledBy}
        orientation={props.orientation}
      >
        <For each={props.tabs}>
          {(tab) => (
            <Tab
              value={tab.id}
              id={tabId(tab.id)}
              controls={panelId(tab.id)}
              disabled={tab.disabled}
            >
              {tab.label}
            </Tab>
          )}
        </For>
      </TabList>
      <For each={props.tabs}>
        {(tab) => (
          <section
            class={styles.panel}
            role="tabpanel"
            id={panelId(tab.id)}
            aria-labelledby={tabId(tab.id)}
            tabindex="0"
            hidden={props.value !== tab.id}
          >
            <Show when={props.value === tab.id}>{tab.panel}</Show>
          </section>
        )}
      </For>
    </div>
  );
}
