import { Button } from './ui/index.js';

export function QuickRequestHistoryButton(props) {
  return <Button id="show-history" class="quick-request-all-button" aria-label="See all Quick Requests" title="See all Quick Requests" onClick={props.onShow}>
    <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M2.5 3.5h11m-11 4h6m-6 4h6m2 0h2.5m-2-2 2 2-2 2" /></svg>
    <span>All</span>
  </Button>;
}
