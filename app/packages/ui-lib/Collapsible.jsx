import { Icon } from "./Icon.jsx";
import styles from "./Collapsible.module.css";

export function Collapsible(props) {
  return (
    <details
      id={props.id}
      class={[styles.disclosure, props.class].filter(Boolean).join(" ")}
      onToggle={(event) => props.onToggle?.(event)}
    >
      <summary class={styles.trigger}>
        <Icon name="chevron" class={styles.indicator} muted />
        {props.label}
      </summary>
      <div
        class={styles.content}
        style={props.maxHeight ? { "max-height": props.maxHeight } : undefined}
        tabindex={props.maxHeight ? 0 : undefined}
      >
        {props.children}
      </div>
    </details>
  );
}
