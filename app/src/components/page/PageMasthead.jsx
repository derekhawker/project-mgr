import { Heading } from "@ui-lib";
import styles from "./PageMasthead.module.css";

export function PageMasthead(props) {
  return (
    <div class={`${styles.masthead} ${props.flush ? styles.flush : ""}`}>
      <Heading level={1} size="subsection" id={props.id} class={styles.context}>
        <span class={styles.type}>{props.type}</span>
        <span class={styles.separator} aria-hidden="true">
          /
        </span>
        {props.onNameClick ? (
          <button
            type="button"
            class={styles.nameButton}
            aria-label={props.nameActionLabel || `Back to ${props.name} ticket list`}
            onClick={props.onNameClick}
          >
            {props.name}
          </button>
        ) : (
          <span>{props.name}</span>
        )}
        {props.segments?.map((segment) => <>
          <span class={styles.separator} aria-hidden="true">/</span>
          <span class={segment.title ? styles.ticketTitle : undefined} title={segment.title}>{segment.label}</span>
        </>)}
        {props.adornment}
      </Heading>
    </div>
  );
}
