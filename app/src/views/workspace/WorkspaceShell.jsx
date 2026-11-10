import { Button, Icon, Tab, TabList } from "@ui-lib";
import { AppPageLayout } from "../../components/page/AppPageLayout.jsx";
import repositoryToolsStyles from "./repository-tools/RepositoryToolsMenu.module.css";
import styles from "./WorkspaceShell.module.css";
export function WorkspaceShell(props) {
  const ticketTitle = () => props.ticketTitle?.();
  const shortenedTicketTitle = () => {
    const title = ticketTitle();
    return title && title.length > 38 ? `${title.slice(0, 35).trimEnd()}…` : title;
  };
  return (
    <div id="workspace-shell" hidden={!props.visible()}>
      <AppPageLayout
        type="Workspace"
        name={props.workspaceName?.()}
        onNameClick={ticketTitle() ? props.onWorkspaceClick : undefined}
        nameActionLabel={ticketTitle() ? `Back to tickets for ${props.workspaceName?.()}` : undefined}
        segments={ticketTitle() ? [{ label: "Tickets" }, { label: shortenedTicketTitle(), title: ticketTitle() }] : []}
        id="workspace-title"
        fullWidth
        adornment={
          props.workspaceRepositoryCount?.() > 0 && (
            <span
              class={styles.repositoryIndicator}
              title={`${props.workspaceRepositoryCount()} associated Git ${props.workspaceRepositoryCount() === 1 ? "repository" : "repositories"}`}
            >
              <Icon name="branch" muted />
              <span class="visually-hidden">
                {props.workspaceRepositoryCount()} associated{" "}
                {props.workspaceRepositoryCount() === 1
                  ? "repository"
                  : "repositories"}
              </span>
            </span>
          )
        }
      >
        <div
          class={styles.toolbar}
          role="group"
          aria-label="Session and workspace views"
        >
          <Button
            id="new-ticket-session"
            type="button"
            disabled={props.newSessionDisabled?.()}
            aria-label="Start a new OpenCode session for this ticket"
            onClick={props.onNewSession}
          >
            New session
          </Button>
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
      </AppPageLayout>
    </div>
  );
}
