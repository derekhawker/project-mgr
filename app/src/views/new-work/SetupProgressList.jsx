import { For } from "solid-js";

export function SetupProgressList(props) {
  return (
    <For each={[...props.rows().values()]}>
      {(row) => (
        <li data-status={row.status}>
          <span>
            {row.label} —{" "}
            {row.status === "running"
              ? "in progress"
              : row.status === "skipped"
                ? "not run"
                : row.status}
          </span>
          <details hidden={!row.detail}>
            <summary>Details</summary>
            <pre>{row.detail || ""}</pre>
          </details>
        </li>
      )}
    </For>
  );
}
