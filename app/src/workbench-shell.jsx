import { Button } from './ui/index.js';
export function WorkbenchShell(props) {
  return (
      <div id="workbench" hidden={!props.visible()}>
        <div class="workbench-toolbar" aria-label="Workspace sessions and tools"></div>
        <div class="workbench-toolbar secondary-toolbar" aria-label="Session and workspace views">
          <nav id="session-tabs" class="session-tabs workbench-session-tabs" role="tablist" aria-label="Workspace sessions" onKeyDown={props.onSessionTabKeydown}></nav>
          <Button id="show-change-review" type="button" class={`toolbar-tab${props.changeReviewSelected() ? ' selected' : ''}`} hidden={!props.changeReviewAvailable()} disabled={props.changeReviewDisabled()} onClick={props.onOpenChangeReview}>Change Review</Button>
          <Button id="show-docs" type="button" class={`toolbar-tab${props.docsButtonSelected() ? ' selected' : ''}`} disabled={props.docsDisabled()} onClick={props.onOpenDocs}>Docs</Button>
          <div id="repo-tools-control" class="repo-tools-control"></div>
        </div>
      </div>
  );
}
