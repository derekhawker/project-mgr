import styles from "./TicketTreeGroup.module.css";

/** One non-merged label heading and its ticket row in the Tickets view. */
export function TicketTreeGroup(props) {
  return (
    <li class={styles.group}>
      <h3 class={styles.heading} title={props.label}>
        {props.label}
      </h3>
      <ul class={styles.children}>{props.children}</ul>
    </li>
  );
}
