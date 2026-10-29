import { Button, Icon } from "@ui-lib";
import styles from "../../application/navigation.module.css";

export function DirectoriesNavigationButton(props) {
  return (
    <div class={styles.directoriesSlot}>
      <Button
        id="show-directories"
        class={styles.directoriesButton}
        aria-label="Open repositories"
        onClick={props.onOpen}
      >
        <Icon name="folder" muted />
        Repositories
      </Button>
    </div>
  );
}
