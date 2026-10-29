import { getDefaultModel, listAvailableModels } from "../services/shell.js";

export function modelSelectorChoices(models, defaultModel) {
  const options = models.map((model) => {
    const providerId = model.providerId ?? model.providerID;
    return {
      value: JSON.stringify({ providerId, id: model.id }),
      label: model.name ?? `${providerId}/${model.id}`,
    };
  });
  const defaultValue = JSON.stringify({
    providerId: defaultModel.providerId,
    id: defaultModel.id,
  });
  const configuredDefaultIsAvailable = options.some(
    (option) => option.value === defaultValue,
  );
  return {
    options,
    selected: configuredDefaultIsAvailable
      ? defaultValue
      : (options[0]?.value ?? ""),
    configuredDefaultIsAvailable,
  };
}

// Commands and transient view callbacks only; JSX owns selector presentation.
export async function initializeModelSelector({
  invoke,
  onReady,
  onError,
  onDefaultUnavailable = () => {},
  view,
}) {
  view?.loading?.();

  try {
    const [defaultModel, models] = await Promise.all([
      getDefaultModel(invoke),
      listAvailableModels(invoke),
    ]);
    if (!models.length)
      throw new Error("No enabled OpenCode models are available.");

    const { configuredDefaultIsAvailable } = modelSelectorChoices(
      models,
      defaultModel,
    );
    onReady(models);
    view?.ready?.(models, defaultModel, configuredDefaultIsAvailable);
    if (!configuredDefaultIsAvailable) onDefaultUnavailable(defaultModel);
    return models;
  } catch (error) {
    onError(error);
    view?.error?.(error);
    return null;
  }
}
