import { ActionMenu, ActionMenuItem } from "@ui-lib";
import styles from "../../application/navigation.module.css";

export function NewWorkMenu(props) {
  const choose = (type, event) => {
    event.currentTarget.closest("details").open = false;
    props.onChoose(type);
  };
  return (
    <div id="new-work-menu" class={styles.newWork}>
      <ActionMenu
        class={styles.newWorkDisclosure}
        triggerClass={styles.newWorkTrigger}
        contentClass={styles.newWorkActions}
        label="New work"
        direction="up"
        actionsLabel="Choose work type"
      >
        <ActionMenuItem
          data-new-work-type="workspace"
          onClick={(event) => choose("workspace", event)}
        >
          Workspace
        </ActionMenuItem>
        <ActionMenuItem
          data-new-work-type="quick_request"
          onClick={(event) => choose("quick_request", event)}
        >
          Quick Request
        </ActionMenuItem>
      </ActionMenu>
    </div>
  );
}
