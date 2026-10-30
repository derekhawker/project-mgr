import { Icon, IconButton } from "@ui-lib";

export function DeleteButton(props) {
  const label = () => `Delete ${props.itemName}`;
  return (
    <IconButton
      label={label()}
      title={label()}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name="trash" />
    </IconButton>
  );
}
