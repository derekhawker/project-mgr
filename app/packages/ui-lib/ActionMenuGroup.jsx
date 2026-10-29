import { splitProps } from "solid-js";
import { Heading } from "./Heading.jsx";
import styles from "./ActionMenuGroup.module.css";

/** A named, vertically stacked menu section; nested sections may use level 3. */
export function ActionMenuGroup(props) {
  const [local, rest] = splitProps(props, [
    "label",
    "headingLevel",
    "class",
    "children",
  ]);
  return (
    <section
      {...rest}
      aria-label={local.label}
      class={`${styles.group} ${local.class || ""}`}
    >
      <Heading
        level={local.headingLevel ?? 2}
        size="compact"
        class={styles.heading}
      >
        {local.label}
      </Heading>
      <div class={styles.items}>{local.children}</div>
    </section>
  );
}
