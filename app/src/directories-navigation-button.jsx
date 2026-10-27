import { Button } from './ui/index.js';
import styles from './navigation.module.css';

export function DirectoriesNavigationButton(props) {
  return <Button id="show-directories" class={styles.directoriesButton} aria-label="Open directories" onClick={props.onOpen}>☰ Directories</Button>;
}
