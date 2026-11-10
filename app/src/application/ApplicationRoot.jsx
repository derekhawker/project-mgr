import { createSignal, onCleanup } from "solid-js";
import styles from "./navigation.module.css";
import { WorkspaceNavigation } from "../views/workbench/WorkspaceNavigation.jsx";
import {
  getUiDiagnostics,
  subscribeUiDiagnostics,
} from "../lib/uiDiagnostics.js";

export function ApplicationRoot(props) {
  const [diagnosticsVersion, setDiagnosticsVersion] = createSignal(0);
  let diagnosticsTimer;
  const unsubscribeDiagnostics = subscribeUiDiagnostics(() => {
    if (diagnosticsTimer !== undefined) return;
    diagnosticsTimer = window.setTimeout(() => {
      diagnosticsTimer = undefined;
      setDiagnosticsVersion((n) => n + 1);
    }, 250);
  });
  onCleanup(() => {
    unsubscribeDiagnostics();
    if (diagnosticsTimer !== undefined)
      window.clearTimeout(diagnosticsTimer);
  });
  const diagnostics = () => {
    diagnosticsVersion();
    return Object.entries(getUiDiagnostics())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => `${label}: ${count}`)
      .join("\n");
  };

  return (
    <>
      <main class="shell">
        <div class="workspace-layout">
          <aside class="navigation" aria-label="Workspace navigation">
            <section class="quick-section">
              <div class="quick-section-heading">
                <h3>Quick Requests</h3>
                {props.quickRequestHistoryButton()}
              </div>
              <ul id="quick-request-list" aria-live="polite">
                {props.quickRequestList()}
              </ul>
            </section>
            <div class="navigation-heading">
              <h2>Workspaces</h2>
              {props.workspaceViewToggle?.()}
            </div>
            <WorkspaceNavigation {...props.workspaceNavigation} />
            <div class={styles.destinations}>
              {props.portsNavigationButton()}
              {props.directoriesNavigationButton()}
            </div>
            <details class="navigation-diagnostics">
              <summary>Navigation diagnostics</summary>
              <pre aria-live="polite">{diagnostics() || "No events recorded."}</pre>
            </details>
            {props.newWorkMenu()}
          </aside>
          <section class="quick-view" aria-label="Selected work">
            {props.workbench()}
            {props.rightContent()}
          </section>
        </div>

        <section class="visually-hidden" aria-labelledby="connection-title">
          {props.applicationStatus()}
        </section>
        {props.appNotice()}
      </main>
      {props.newWorkDialog()}
    </>
  );
}
