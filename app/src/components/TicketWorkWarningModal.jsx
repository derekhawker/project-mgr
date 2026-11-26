import { Button, Modal } from "@ui-lib";

/** Makes an unverifiable session worktree visible before opening its ticket session. */
export function TicketWorkWarningModal(props) {
  return (
    <Modal
      open={() => Boolean(props.warning())}
      title="Ticket worktree could not be verified"
      onCloseRequest={props.onCancel}
      footer={
        <>
          <Button type="button" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={props.busy()}
            onClick={props.onContinue}
          >
            Continue
          </Button>
        </>
      }
    >
      <p role="alert">{props.warning()}</p>
    </Modal>
  );
}
