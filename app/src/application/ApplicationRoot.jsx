import styles from "./navigation.module.css";

export function ApplicationRoot(props) {
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
            {props.workspaceNavigation()}
            <div class={styles.destinations}>
              {props.portsNavigationButton()}
              {props.directoriesNavigationButton()}
            </div>
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
