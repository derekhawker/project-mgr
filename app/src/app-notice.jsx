export function AppNotice(props) {
  return <p id="app-notice" class="app-notice" role="status" aria-live="polite" hidden={!props.message()}>{props.message()}</p>;
}
