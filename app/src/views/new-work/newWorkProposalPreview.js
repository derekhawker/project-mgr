export function createNewWorkProposalPreview({
  requestPreview,
  setPreview,
}) {
  let open = false;
  let request = 0;
  let loadedPreview = null;

  async function loadPreview(requestId) {
    try {
      const result = await requestPreview();
      if (requestId === request && open) {
        loadedPreview = result;
        setPreview(result);
      }
    } catch (error) {
      if (requestId === request && open)
        setPreview(`Could not load preview: ${error}`);
    }
  }

  return {
    open() {
      open = true;
      if (loadedPreview !== null) {
        setPreview(loadedPreview);
        return;
      }
      const requestId = ++request;
      setPreview("Loading proposal template…");
      void loadPreview(requestId);
    },
    close() {
      open = false;
      request++;
      setPreview("");
    },
  };
}
