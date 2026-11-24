/** App-owned terminal DOM stays mounted while destination views are replaced. */
export function TerminalSurface(props) {
  return (
    <>
      <p
        id="session-status"
        class="visually-hidden"
        role="status"
        aria-live="polite"
      >
        {props.sessionStatus()}
      </p>
      <ul
        id="pending-inputs"
        class="visually-hidden"
        aria-label="Pending input"
      >
        {props.pendingInputs?.()}
      </ul>
      <section
        class="terminal-card"
        aria-label="OpenCode terminal"
        hidden={!props.visible()}
      >
        <div
          id="terminal-views"
          class="terminal-views"
          ref={props.setTerminalViews}
        />
      </section>
    </>
  );
}
