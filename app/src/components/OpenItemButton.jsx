import { Icon, IconButton } from "@ui-lib";

/** A shared folder-icon action for opening a named record in its owning view. */
export function OpenItemButton(props) {
  const action = () => props.action || "Open";
  const accessibleName = () => `${action()} ${props.itemType}: ${props.itemName}`;
  return (
    <IconButton
      class={props.class}
      label={accessibleName()}
      title={props.title || `${action()} ${props.itemType}`}
      disabled={props.disabled}
      aria-pressed={props["aria-pressed"]}
      onClick={props.onClick}
    >
      <Icon name="folder" />
    </IconButton>
  );
}
