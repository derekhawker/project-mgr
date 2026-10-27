import { createSignal } from 'solid-js';
import { submitQuickRequestFlow } from './shell.js';

// Transient presentation state shared by the production JSX and submit adapter.
// Kept independent of native/DOM APIs for nonvisual production-path tests.
export function createQuickRequestFormView() {
  const [getPrompt, setPrompt] = createSignal('');
  const [isBusy, setBusy] = createSignal(false);
  return { getPrompt, setPrompt, isBusy, setBusy };
}

// Production supplies the Solid view. DOM controls are a compatibility fallback
// for bindQuickRequestForm's legacy event-adapter tests, not the app's view.
export function createQuickRequestSubmitHandler({
  view,
  promptInput,
  modelSelect,
  getSelectedModel,
  submitButton,
  errorMessage,
  setErrorMessage,
  invoke,
  isReady,
  waitForTerminal,
  showSession,
  refreshRequests,
}) {
  const promptView = view ?? {
    getPrompt: () => promptInput.value,
    setPrompt: (text) => { promptInput.value = text; },
    setBusy: (busy) => { submitButton.disabled = busy || !isReady(); },
  };
  const onSubmit = async (event) => {
    event.preventDefault();
    if (!isReady()) return;
    promptView.setBusy(true);
    if (setErrorMessage) setErrorMessage('');
    else errorMessage.textContent = '';
    try {
      const model = JSON.parse(getSelectedModel ? getSelectedModel() : modelSelect.value);
      return await submitQuickRequestFlow({
        invoke,
        setPrompt: promptView.setPrompt,
        promptText: promptView.getPrompt(),
        model,
        waitForTerminal,
        showSession,
        refreshRequests,
      });
    } catch (error) {
      if (setErrorMessage) setErrorMessage(String(error));
      else errorMessage.textContent = String(error);
    } finally {
      promptView.setBusy(false);
    }
  };

  return onSubmit;
}

export function bindQuickRequestForm(options) {
  const { form } = options;
  const onSubmit = createQuickRequestSubmitHandler(options);
  let pendingSubmission = Promise.resolve();

  const listener = (event) => {
    pendingSubmission = onSubmit(event);
  };
  form.addEventListener('submit', listener);

  return {
    whenSettled: () => pendingSubmission,
    dispose: () => {
      form.removeEventListener('submit', listener);
    },
  };
}
