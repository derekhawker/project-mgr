import { createUniqueId, For, Show } from "solid-js";
import { Button, Checkbox, Icon, Tooltip } from "@ui-lib";
import { AppPageLayout } from "../../components/page/AppPageLayout.jsx";
import { PortsInput } from "./PortsInput.jsx";
import { PortsEmptyState } from "./PortsEmptyState.jsx";
import { PortProcessItem } from "./PortProcessItem.jsx";
import { DEFAULT_PORT_SELECTION } from "./portsController.js";
import styles from "./PortsPage.module.css";

export function PortsPage(p) {
  const allPortsId = createUniqueId();
  const filtered = () =>
    p.allPorts()
      ? p.rows()
      : p.rows().filter((row) => row.ports.some(p.matchesPort));
  return (
    <section
      class={styles.page}
      classList={{ [styles.hidden]: !p.visible() }}
      aria-label="Ports"
      hidden={!p.visible()}
    >
      <AppPageLayout
        type="Ports"
        name="Listening ports"
        fullWidth
        fill
        fillContent
        class={styles.layout}
      >
        <div class={styles.toolbar}>
          <Button onClick={p.refresh} disabled={p.busy()}>
            {p.busy() ? "Refreshing…" : "Refresh"}
          </Button>
          <div class={styles.allPorts}>
            <Checkbox
              id={allPortsId}
              checked={p.allPorts()}
              onChange={(e) => p.setAllPorts(e.currentTarget.checked)}
            />
            <label class={styles.allPortsLabel} for={allPortsId}>
              All listening ports
            </label>
          </div>
          <div class={styles.reset}>
            <div class={styles.actionHelp}>
              <Button class={styles.actionButton} onClick={p.reset}>
                Reset to default ports list
              </Button>
              <Tooltip
                class={styles.tooltipSlot}
                content={`${DEFAULT_PORT_SELECTION}`}
                renderTrigger={(tooltipProps) => (
                  <button
                    {...tooltipProps}
                    type="button"
                    class={styles.helpTrigger}
                    aria-label="Reset ports help"
                  >
                    <Icon name="questionMark" />
                  </button>
                )}
              />
            </div>
          </div>
        </div>
        <p className={styles.meta}>
          {p.updated() ? `Last updated ${p.updated()}.` : "Not refreshed yet."}
        </p>

        <div class={styles.selection}>
          <span class={styles.fieldLabel}>Ports</span>
          <PortsInput value={p.selection} onChange={p.changeSelection} />
        </div>
        <Show when={p.error()}>
          <p role="alert" className={styles.error}>
            {p.error()}
          </p>
        </Show>
        <Show when={p.busy() && !p.rows().length}>
          <p>Inspecting TCP listeners…</p>
        </Show>
        <Show when={!p.busy() && !filtered().length && !p.error()}>
          <PortsEmptyState filtered={!!p.rows().length} />
        </Show>
        <div class={styles.list}>
          <For each={filtered()}>
            {(row) => (
              <PortProcessItem
                row={row}
                stopping={p.stopping() === row.pid}
                onStop={p.stop}
              />
            )}
          </For>
        </div>
      </AppPageLayout>
    </section>
  );
}
