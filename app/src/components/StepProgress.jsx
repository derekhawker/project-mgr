import { For, Show } from "solid-js";
import styles from "./StepProgress.module.css";

/** Shared numbered progress display for short, modal-owned workflows. */
export function StepProgress(props) {
  const activeStep = () =>
    typeof props.activeStep === "function"
      ? props.activeStep()
      : props.activeStep;
  const isSkipped = (step) =>
    typeof step.skipped === "function" ? step.skipped() : Boolean(step.skipped);

  return (
    <div class={styles.progress}>
      <ol aria-label={props.label} class={styles.steps}>
        <For each={props.steps}>
          {(step, index) => (
            <li
              aria-current={activeStep() === index() + 1 ? "step" : undefined}
              aria-disabled={isSkipped(step) ? "true" : undefined}
              classList={{ [styles.current]: activeStep() === index() + 1 }}
            >
              <span class={styles.stepNumber}>{index() + 1}</span>
              <span class={styles.stepLabel}>
                {step.label}
                <Show when={isSkipped(step)}>
                  <span class={styles.skipped}> (skipped)</span>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}
