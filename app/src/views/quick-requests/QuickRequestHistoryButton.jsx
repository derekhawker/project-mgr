import { Icon, IconButton } from "@ui-lib";

export function QuickRequestHistoryButton(props) {
  return (
    <IconButton
      id="show-history"
      label="See all Quick Requests"
      title="See all Quick Requests"
      onClick={props.onShow}
    >
      <Icon name="list" />
    </IconButton>
  );
}
