import { Icon } from "@ui-lib";
import styles from "./PortTag.module.css";

export function PortTag(props) {
  const handleKeyDown = (event) => {
    if (event.key !== "Backspace") return;
    event.preventDefault();
    props.onRemove();
  };

  return <span class={styles.tag}>
    <button type="button" class={styles.value} aria-label={`Edit ${props.value}`} onKeyDown={handleKeyDown} onClick={props.onEdit}>
      {props.value.replace("-", " — ")}
    </button>
    <button type="button" tabIndex={-1} class={styles.remove} aria-label={`Remove ${props.value}`} onClick={props.onRemove}>
      <Icon name="close" />
    </button>
  </span>;
}
