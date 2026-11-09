import { PageMasthead } from "./PageMasthead.jsx";
import styles from "./AppPageLayout.module.css";

export function AppPageLayout(props) {
  return (
    <div
      class={`${styles.layout} ${props.class ?? ""}`}
      classList={{
        [styles.fill]: props.fill,
        [styles.edgeToEdge]: props.edgeToEdge,
      }}
    >
      <PageMasthead
        type={props.type}
        name={props.name}
        id={props.id}
        adornment={props.adornment}
        flush={props.edgeToEdge}
      />
      <div
        class={`${styles.content} ${props.contentClass ?? ""}`}
        classList={{
          [styles.fullWidth]: props.fullWidth || props.edgeToEdge,
          [styles.fillContent]: props.fillContent,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
