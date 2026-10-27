import { ActionMenu, Button } from './ui/index.js';
import styles from './navigation.module.css';

export function NewWorkMenu(props) {
  const choose = (type, event) => {
    event.currentTarget.closest('details').open = false;
    props.onChoose(type);
  };
  return <div id="new-work-menu" class={styles.newWork}>
    <ActionMenu class={styles.newWorkDisclosure} label="New work" actionsLabel="Choose work type">
      <Button data-new-work-type="workspace" onClick={(event) => choose('workspace', event)}>Workspace</Button>
      <Button data-new-work-type="quick_request" onClick={(event) => choose('quick_request', event)}>Quick Request</Button>
    </ActionMenu>
  </div>;
}
