import { Button } from './ui/index.js';

export function QuickRequestHeading(props) {
  return <div class="quick-request-list-heading"><h1 id="quick-request-full-title">Quick Requests</h1>
    <Button id="new-quick-request" variant="primary" onClick={props.onNew}>New Quick Request</Button>
  </div>;
}
