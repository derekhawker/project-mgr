import { Heading, Tab, TabList } from "@ui-lib";
import repositoryToolsStyles from "../repository-tools/RepositoryToolsMenu.module.css";
import styles from "./WorkbenchShell.module.css";
export function WorkbenchShell(props) {
  return (
    <div id="workbench" hidden={!props.visible()}>
      <Heading level={1} size="subsection" class={styles.heading}>
        {props.workspaceName?.()}
      </Heading>
      <div
        class={styles.toolbar}
        role="group"
        aria-label="Session and workspace views"
      >
        <TabList
          id="session-tabs"
          class={styles.tabs}
          label="Workspace views"
          value={
            props.docsButtonSelected()
              ? "docs"
              : props.changeReviewSelected()
                ? "change-review"
                : props.selectedSessionId()
          }
        >
          {props.sessionTabs?.()}
          <Tab
            id="show-change-review"
            value="change-review"
            controls="change-review-page"
            hidden={!props.changeReviewAvailable()}
            disabled={
              props.changeReviewDisabled() && !props.changeReviewSelected()
            }
            onClick={(event) => {
              if (!props.changeReviewDisabled())
                props.onOpenChangeReview(event);
            }}
          >
            Change Review
          </Tab>
          <Tab
            id="show-docs"
            value="docs"
            controls="docs-page"
            disabled={props.docsDisabled() && !props.docsButtonSelected()}
            onClick={(event) => {
              if (!props.docsDisabled()) props.onOpenDocs(event);
            }}
          >
            Docs
          </Tab>
        </TabList>
        <div id="repo-tools-control" class={repositoryToolsStyles.control}>
          {props.repositoryTools?.()}
        </div>
      </div>
    </div>
  );
}
