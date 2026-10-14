import { submitQuickRequestFlow } from './shell.js';

// Owns the rendered form's submit lifecycle so browser-level tests exercise the
// same event handler as production. The app injects only the Tauri transport and
// terminal/UI collaborators; command names, schemas, and result validation stay
// in the production adapters.
export function bindQuickRequestForm({
  form,
  promptInput,
  modelSelect,
  submitButton,
  errorMessage,
  invoke,
  isReady,
  waitForTerminal,
  showSession,
  refreshRequests,
}) {
  let pendingSubmission = Promise.resolve();

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!isReady()) return;
    submitButton.disabled = true;
    errorMessage.textContent = '';
    try {
      const model = JSON.parse(modelSelect.value);
      await submitQuickRequestFlow({
        invoke,
        promptInput,
        promptText: promptInput.value,
        model,
        waitForTerminal,
        showSession,
        refreshRequests,
      });
    } catch (error) {
      errorMessage.textContent = String(error);
    } finally {
      submitButton.disabled = !isReady();
    }
  };

  const listener = (event) => {
    pendingSubmission = onSubmit(event);
  };
  form.addEventListener('submit', listener);

  return {
    whenSettled: () => pendingSubmission,
    dispose: () => form.removeEventListener('submit', listener),
  };
}
