import { createSignal, Show } from "solid-js";
import {
  Button,
  Checkbox,
  ErrorMessage,
  Input,
  Modal,
  TextArea,
} from "@ui-lib";
import styles from "./CreateTicketIdeaModal.module.css";

/** Captures an idea, reviews generated content, then asks the owner to save it. */
export function CreateTicketIdeaModal(props) {
  const [open, setOpen] = createSignal(false);
  let generation = 0;
  const openDialog = () => {
    generation++;
    setOpen(true);
  };
  const closeDialog = () => {
    generation++;
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="primary"
        disabled={Boolean(props.disabled?.())}
        onClick={openDialog}
      >
        Create ticket…
      </Button>
      <Modal
        open={() => open()}
        title="Create a ticket from an idea"
        size="wide"
        onCloseRequest={closeDialog}
        renderContent={() => {
          // This render factory runs inside Modal's open-scoped Show owner. Its
          // workflow state is therefore discarded whenever the dialog closes.
          const contentGeneration = generation;
          const isCurrent = () => open() && generation === contentGeneration;
          const [step, setStep] = createSignal(1);
          const [idea, setIdea] = createSignal("");
          const [title, setTitle] = createSignal("");
          const [body, setBody] = createSignal("");
          const [startInvestigation, setStartInvestigation] =
            createSignal(false);
          const [busy, setBusy] = createSignal(false);
          const [error, setError] = createSignal("");

          async function propose(event) {
            event.preventDefault();
            if (!idea().trim() || busy()) return;
            setBusy(true);
            setError("");
            try {
              const proposal = await props.onPropose(idea());
              if (!isCurrent()) return;
              setTitle(proposal.title);
              setBody(proposal.body);
              setStep(2);
            } catch (cause) {
              if (isCurrent())
                setError(
                  `Could not prepare a ticket proposal: ${String(cause)}`,
                );
            } finally {
              if (isCurrent()) setBusy(false);
            }
          }

          async function create() {
            if (busy()) return;
            setBusy(true);
            setError("");
            try {
              const ticket = await props.onCreate(
                title(),
                body(),
                startInvestigation(),
              );
              if (!isCurrent()) return;
              await props.onTicketCreated?.(ticket);
              if (!isCurrent()) return;
              closeDialog();
            } catch (cause) {
              if (isCurrent())
                setError(
                  `Could not create the ticket. Your edits are still here. ${String(cause)}`,
                );
            } finally {
              if (isCurrent()) setBusy(false);
            }
          }

          const footer = (
            <div class={styles.actions}>
              <Show when={step() === 2}>
                <label class={styles.investigationOption}>
                  <Checkbox
                    checked={startInvestigation()}
                    disabled={busy()}
                    onChange={(event) =>
                      setStartInvestigation(event.currentTarget.checked)
                    }
                  />
                  <span>
                    <strong>Start ticket</strong>
                  </span>
                </label>
              </Show>
              <Show when={step() === 2}>
                <Button
                  type="button"
                  disabled={busy()}
                  onClick={() => {
                    setStep(1);
                    setError("");
                  }}
                >
                  Back
                </Button>
              </Show>
              <Button type="button" onClick={closeDialog}>
                Cancel
              </Button>
              <Show when={step() === 1}>
                <Button
                  type="submit"
                  form="ticket-idea-form"
                  variant="primary"
                  disabled={busy() || !idea().trim()}
                >
                  {busy() ? "Preparing…" : "Review proposal"}
                </Button>
              </Show>
              <Show when={step() === 2}>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy() || !title().trim() || !body().trim()}
                  onClick={create}
                >
                  {busy() ? "Creating…" : "Create ticket"}
                </Button>
              </Show>
            </div>
          );

          return {
            body: (
              <>
                <div class={styles.progress}>
                  <ol aria-label="Ticket creation steps" class={styles.steps}>
                    <li
                      aria-current={step() === 1 ? "step" : undefined}
                      classList={{ [styles.current]: step() === 1 }}
                    >
                      <span class={styles.stepNumber}>1</span>
                      <span class={styles.stepLabel}>Description</span>
                    </li>
                    <li
                      aria-current={step() === 2 ? "step" : undefined}
                      classList={{ [styles.current]: step() === 2 }}
                    >
                      <span class={styles.stepNumber}>2</span>
                      <span class={styles.stepLabel}>Review</span>
                    </li>
                  </ol>
                </div>
                <ErrorMessage message={error} />
                <Show when={step() === 1}>
                  <form
                    id="ticket-idea-form"
                    class={styles.form}
                    onSubmit={propose}
                  >
                    <label for="ticket-idea">
                      What would you like this ticket to capture?
                    </label>
                    <TextArea
                      id="ticket-idea"
                      rows="7"
                      required
                      autofocus
                      value={idea()}
                      disabled={busy()}
                      onInput={(event) => setIdea(event.currentTarget.value)}
                      placeholder="Describe the problem, idea, or question…"
                    />
                  </form>
                </Show>
                <Show when={step() === 2}>
                  <div class={styles.form}>
                    <label for="ticket-title">Title</label>
                    <Input
                      id="ticket-title"
                      required
                      value={title()}
                      disabled={busy()}
                      onInput={(event) => setTitle(event.currentTarget.value)}
                    />
                    <label for="ticket-status">Status</label>
                    <Input id="ticket-status" value="draft" readonly />
                    <label for="ticket-body">Markdown body</label>
                    <TextArea
                      id="ticket-body"
                      rows="15"
                      required
                      value={body()}
                      disabled={busy()}
                      onInput={(event) => setBody(event.currentTarget.value)}
                    />
                    <p class={styles.note}>
                      The status is managed by the app. Your title and Markdown
                      body are editable.
                    </p>
                  </div>
                </Show>
              </>
            ),
            footer,
          };
        }}
      />
    </>
  );
}
