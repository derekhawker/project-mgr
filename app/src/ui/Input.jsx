import { splitProps } from "solid-js";
import styles from "./controls.module.css";

export function Input(props) {
  const [local, rest] = splitProps(props, ["class", "className"]);
  return <input {...rest} class={`${styles.field} ${local.class || local.className || ""}`} />;
}
