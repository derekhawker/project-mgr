import { Button, Icon } from "@ui-lib";
import styles from "../../application/navigation.module.css";

export function PortsNavigationButton(props) {
  return <div class={styles.portsSlot}><Button class={styles.directoriesButton} aria-label="Open ports" onClick={props.onOpen}><Icon name="ports" muted />Ports</Button></div>;
}
