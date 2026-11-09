import { splitProps } from "solid-js";
import styles from "./Icon.module.css";

const icons = {
  chevron: "M4 6l4 4 4-4",
  close: "M4 4l8 8M12 4l-8 8",
  branch:
    "M4 3v10m8-10v3a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 0 4 11m8-4a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM4 15a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  folder: "M1.5 4.5h5l1.5 1.5h6.5v7h-13zM1.5 4.5v-2h4l1.5 2",
  folderOpen:
    "M1.5 5.5h13l-1.5 7H3l-1.5-7ZM1.5 5.5V3h4l1.5 1.5h4",
  list: "M2.5 3.5h11m-11 4h6m-6 4h6m2 0h2.5m-2-2 2 2-2 2",
  circleX: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM5.5 5.5l5 5m0-5-5 5",
  refresh: "M13 5.5A5.5 5.5 0 1 0 13.5 9M13 2.5v3h-3",
  ports: "M2 4h12v8H2zM5 4v3h6V4M5 10h.1M8 10h.1M11 10h.1",
  questionMark: "M5.5 5.5a2.5 2.5 0 1 1 4.2 1.8C8.5 8.4 8 8.8 8 10m0 2.5v.1",
  trash: "M2.5 4h11M6 4V2.5h4V4m2.5 0-.7 9.5h-7.6L3.5 4m3 2.5v4m3-4v4",
};

/** Renders a decorative inline SVG icon at a consistent size. */
export function Icon(props) {
  const [local, rest] = splitProps(props, ["name", "size", "muted", "class"]);
  return (
    <svg
      {...rest}
      class={`${styles.icon} ${styles[local.size || "medium"]} ${local.muted ? styles.muted : ""} ${local.class || ""}`}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
    >
      <path d={icons[local.name]} />
    </svg>
  );
}
