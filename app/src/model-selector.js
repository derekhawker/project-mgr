import { getDefaultModel, listAvailableModels, populateModelSelector } from './shell.js';

// Connects the production model command to the actual selector and startup
// controls. The error transition clears stale options and keeps every dependent
// submit action disabled.
export async function initializeModelSelector({
  invoke,
  select,
  onReady,
  onError,
  onDefaultUnavailable = () => {},
}) {
  select.disabled = true;
  select.setAttribute('aria-busy', 'true');

  try {
    const [defaultModel, models] = await Promise.all([
      getDefaultModel(invoke),
      listAvailableModels(invoke),
    ]);
    if (!models.length) throw new Error('No enabled OpenCode models are available.');

    populateModelSelector(select, models);
    const defaultValue = JSON.stringify({
      providerId: defaultModel.providerId,
      id: defaultModel.id,
    });
    const configuredDefaultIsAvailable = Array.from(select.options)
      .some((option) => option.value === defaultValue);
    if (configuredDefaultIsAvailable) select.value = defaultValue;
    select.disabled = false;
    select.setAttribute('aria-busy', 'false');
    onReady(models);
    if (!configuredDefaultIsAvailable) onDefaultUnavailable(defaultModel);
    return models;
  } catch (error) {
    select.replaceChildren();
    select.disabled = true;
    select.setAttribute('aria-busy', 'false');
    onError(error);
    return null;
  }
}
