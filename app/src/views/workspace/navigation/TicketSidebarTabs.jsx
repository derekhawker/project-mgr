import { Tab, TabList } from "@ui-lib";
import styles from "./TicketSidebarTabs.module.css";

export function TicketSidebarTabs(props) {
  return (
    <section class={styles.header} aria-label="Ticket Sidebar">
      <TabList
        id="ticket-sidebar-tabs"
        class={styles.tabs}
        label="Ticket Sidebar views"
        value={props.value()}
        onChange={props.onChange}
      >
        <Tab
          id="ticket-sidebar-recent"
          value="recent"
          controls="ticket-sidebar-list"
        >
          Recent
        </Tab>
        <Tab
          id="ticket-sidebar-workspaces"
          value="workspaces"
          controls="ticket-sidebar-list"
        >
          Workspaces
        </Tab>
      </TabList>
    </section>
  );
}
