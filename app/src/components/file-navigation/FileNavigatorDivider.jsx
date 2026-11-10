import styles from "./FileNavigatorDivider.module.css";

export function FileNavigatorDivider(props) {
  let drag;
  const width = () => props.width?.() ?? 300;
  const clamp = (value) => Math.max(120, Math.min(640, Math.round(value)));
  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    props.onResize?.(clamp(drag.width + event.clientX - drag.x), false);
  }
  function finish(event) {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    props.onResize?.(width(), true);
  }
  return (
    <div
      class={styles.divider}
      role="separator"
      aria-label="Resize file navigator"
      aria-orientation="vertical"
      aria-valuemin="120"
      aria-valuemax="640"
      aria-valuenow={width()}
      tabindex="0"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag = { id: event.pointerId, x: event.clientX, width: width() };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        props.onResize?.(
          clamp(width() + (event.key === "ArrowLeft" ? -10 : 10)),
          true,
        );
      }}
    />
  );
}
