import { Button, Heading } from "@ui-lib";

export function QuickRequestHeading(props) {
  return (
    <div class="quick-request-list-heading">
      <Heading level={1} size="page" id="quick-request-full-title">
        Quick Requests
      </Heading>
      <Button id="new-quick-request" variant="primary" onClick={props.onNew}>
        New Quick Request
      </Button>
    </div>
  );
}
