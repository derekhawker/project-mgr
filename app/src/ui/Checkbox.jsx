import { splitProps } from "solid-js";
import styles from "./controls.module.css";

export function Checkbox(props) {
  const [local, rest] = splitProps(props, ["class", "className"]);
  return <input {...rest} type="checkbox" class={`${styles.checkbox} ${local.class || local.className || ""}`} />;
}
