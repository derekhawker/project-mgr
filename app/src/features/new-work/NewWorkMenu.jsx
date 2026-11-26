import { ActionMenu, ActionMenuItem } from "@ui-lib";
import styles from "../../application/navigation.module.css";

export function NewWorkMenu(props) {
  const choose = (type) => props.onChoose(type);
  return (
    <div id="new-work-menu" class={styles.newWork}>
      <ActionMenu
        class={styles.newWorkDisclosure}
        triggerClass={styles.newWorkTrigger}
        contentClass={styles.newWorkActions}
        label="New work…"
        direction="up"
        actionsLabel="Choose work type"
      >
        <ActionMenuItem
          data-new-work-type="workspace"
          onClick={() => choose("workspace")}
        >
          Workspace
        </ActionMenuItem>
        <ActionMenuItem
          data-new-work-type="quick_request"
          onClick={() => choose("quick_request")}
        >
          Quick Request
        </ActionMenuItem>
      </ActionMenu>
    </div>
  );
}
