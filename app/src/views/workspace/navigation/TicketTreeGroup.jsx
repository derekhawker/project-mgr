import styles from "./TicketTreeGroup.module.css";

/** A label heading and one consecutive run of tickets in the Recent view. */
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
