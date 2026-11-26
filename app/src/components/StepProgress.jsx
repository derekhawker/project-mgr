import { For } from "solid-js";
import styles from "./StepProgress.module.css";

/** Shared numbered progress display for short, modal-owned workflows. */
export function StepProgress(props) {
  const activeStep = () =>
    typeof props.activeStep === "function"
      ? props.activeStep()
      : props.activeStep;
  const isDisabled = (step) =>
    typeof step.disabled === "function"
      ? step.disabled()
      : Boolean(step.disabled);

  return (
    <div class={styles.progress}>
      <ol aria-label={props.label} class={styles.steps}>
        <For each={props.steps}>
          {(step, index) => (
            <li
              aria-current={activeStep() === index() + 1 ? "step" : undefined}
              aria-disabled={isDisabled(step) ? "true" : undefined}
              classList={{ [styles.current]: activeStep() === index() + 1 }}
            >
              <span class={styles.stepNumber}>{index() + 1}</span>
              <span class={styles.stepLabel}>{step.label}</span>
            </li>
          )}
        </For>
      </ol>
    </div>
  );
}
