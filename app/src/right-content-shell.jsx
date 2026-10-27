export function RightContentShell(props) {
  return <div id="right-content" class="right-content" classList={{
    'owner-active': props.ownerActive(),
    'quick-request-terminal-page': props.quickRequestTerminalPage(),
  }}>
    <div id="change-review-root"></div>
    <div id="quick-request-history-root"></div>
    <div id="directories-page-root"></div>
    <div id="no-selection-root"></div>
    <div id="docs-root"></div>
    <div id="workspace-owner-panel-root"></div>
  </div>;
}
