export function RightContentShell(props) {
  return (
    <div
      id="right-content"
      class="right-content"
      classList={{
        "owner-active": props.ownerActive(),
        "quick-request-terminal-page": props.quickRequestTerminalPage(),
      }}
    >
      {props.changeReview?.()}
      {props.quickRequestHistory?.()}
      {props.directoriesPage?.()}
      {props.noSelection?.()}
      {props.docsPane?.()}
      {props.workspaceOwnerPanel?.()}
    </div>
  );
}
