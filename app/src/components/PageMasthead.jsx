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
        <span>{props.name}</span>
        {props.adornment}
      </Heading>
    </div>
  );
}
