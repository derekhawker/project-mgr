import { createSignal, For, Show } from "solid-js";
import { Button, ErrorMessage, Icon, Modal } from "@ui-lib";
import { StepProgress } from "../../../components/StepProgress.jsx";
import styles from "./DeleteWorkspaceModal.module.css";

/** Confirms ticket archiving first, then Workspace record removal. */
export function DeleteWorkspaceModal(props) {
  const [open, setOpen] = createSignal(false);
  let generation = 0;
  const openDialog = () => {
    generation += 1;
    setOpen(true);
  };
  const closeDialog = () => {
    generation += 1;
    setOpen(false);
  };

  return (
    <>
      <Button type="button" onClick={openDialog}>
        Delete workspace…
      </Button>
      <Modal
        open={() => open()}
        title="Delete workspace"
        size="wide"
        onCloseRequest={closeDialog}
        renderContent={() => {
          const contentGeneration = generation;
          const isCurrent = () => open() && generation === contentGeneration;
          const [step, setStep] = createSignal(1);
          const [tickets, setTickets] = createSignal([]);
          const [ticketsLoaded, setTicketsLoaded] = createSignal(false);
          const [busy, setBusy] = createSignal(true);
          const [error, setError] = createSignal("");

          void (async () => {
            try {
              const result = await props.onLoadTickets();
              if (!isCurrent()) return;
              setTickets(result);
              setTicketsLoaded(true);
              if (result.length === 0) setStep(2);
            } catch (cause) {
              if (isCurrent())
                setError(`Could not load tickets: ${String(cause)}`);
            } finally {
              if (isCurrent()) setBusy(false);
            }
          })();

          const workspaceName = () =>
            props.workspaceName?.() ?? "this Workspace";

          async function archiveTickets() {
            if (busy() || !ticketsLoaded()) return;
            setBusy(true);
            setError("");
            try {
              await props.onArchiveTickets();
              if (isCurrent()) setStep(2);
            } catch (cause) {
              if (isCurrent())
                setError(`Could not archive the tickets. ${String(cause)}`);
            } finally {
              if (isCurrent()) setBusy(false);
            }
          }

          async function removeWorkspace() {
            if (busy()) return;
            setBusy(true);
            setError("");
            try {
              await props.onDeleteWorkspace();
              if (!isCurrent()) return;
              closeDialog();
              await props.onDeleted?.();
            } catch (cause) {
              if (isCurrent())
                setError(`Could not delete the Workspace. ${String(cause)}`);
            } finally {
              if (isCurrent()) setBusy(false);
            }
          }

          const footer = (
            <div class={styles.actions}>
              <Button type="button" disabled={busy()} onClick={closeDialog}>
                Cancel
              </Button>
              <Show when={step() === 1}>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy() || !ticketsLoaded()}
                  onClick={archiveTickets}
                >
                  {busy()
                    ? "Loading tickets…"
                    : tickets().length
                      ? "Archive tickets and continue"
                      : "Continue"}
                </Button>
              </Show>
              <Show when={step() === 2}>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy()}
                  onClick={removeWorkspace}
                >
                  <Icon name="trash" />
                  {busy() ? "Deleting…" : "Delete workspace"}
                </Button>
              </Show>
            </div>
          );

          return {
            body: (
              <div class={styles.content}>
                <StepProgress
                  label="Workspace deletion steps"
                  activeStep={step}
                  steps={[
                    {
                      label: "Archive tickets",
                      skipped: () => ticketsLoaded() && tickets().length === 0,
                    },
                    { label: "Delete Workspace" },
                  ]}
                />
                <ErrorMessage message={error()} />
                <Show when={step() === 1}>
                  <p>
                    Active tickets will be moved to the archived folder. Tickets
                    that are not done will be marked cancelled. Done tickets
                    will remain unchanged. No ticket files will be deleted.
                  </p>
                  <Show
                    when={tickets().length > 0}
                    fallback={<p>No active tickets to archive.</p>}
                  >
                    <ul
                      class={styles.ticketList}
                      aria-label="Tickets to archive"
                    >
                      <For each={tickets()}>
                        {(ticket) => (
                          <li>
                            <span>{ticket.title}</span>
                            <span>{ticket.status}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <p>Continue to the Workspace deletion confirmation?</p>
                </Show>
                <Show when={step() === 2}>
                  <Show when={ticketsLoaded() && tickets().length === 0}>
                    <p>
                      No active tickets to archive; the archive step was
                      skipped.
                    </p>
                  </Show>
                  <p>
                    Permanently remove <strong>{workspaceName()}</strong> from
                    the app? Its linked repository, ticket files, and OpenCode
                    conversations will be retained. App-side session links will
                    be removed; conversations remain in OpenCode.
                  </p>
                </Show>
              </div>
            ),
            footer,
          };
        }}
      />
    </>
  );
}
