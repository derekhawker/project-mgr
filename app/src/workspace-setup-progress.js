function repositoryReference(repositoryId, proposalRepositories, repositoryCatalog) {
  const proposalRepository = (proposalRepositories || []).find((item) => item.repositoryId === repositoryId);
  const repository = (repositoryCatalog || []).find((item) => item.id === repositoryId);
  const name = repository?.name || proposalRepository?.name || 'Repository';
  const path = repository?.repositoryPath || proposalRepository?.sourcePath || 'Location unavailable';
  return `${name} — ${path}`;
}

function hideRepositoryIds(text, proposalRepositories, repositoryCatalog) {
  let safeText = String(text || '');
  const ids = new Set([
    ...(proposalRepositories || []).map((item) => item.repositoryId),
    ...(repositoryCatalog || []).map((item) => item.id),
  ].filter(Boolean));
  for (const id of ids) {
    safeText = safeText.split(id).join(repositoryReference(id, proposalRepositories, repositoryCatalog));
  }
  return safeText.replace(/\brepo-[\w-]+\b/g, 'repository');
}

export function workspaceProgressPresentation(payload, proposalRepositories, repositoryCatalog) {
  const key = String(payload?.key || '');
  const repositoryId = /^(?:clone|session):(.+)$/.exec(key)?.[1];
  const reference = repositoryId
    ? repositoryReference(repositoryId, proposalRepositories, repositoryCatalog)
    : null;
  const label = repositoryId
    ? key.startsWith('clone:') ? `Clone ${reference}` : `Start ${reference} terminal`
    : hideRepositoryIds(payload?.label || 'Workspace setup', proposalRepositories, repositoryCatalog);
  return {
    label,
    detail: payload?.detail
      ? hideRepositoryIds(payload.detail, proposalRepositories, repositoryCatalog)
      : null,
  };
}

export function workspaceSetupFailureDetails(failures, proposalRepositories, repositoryCatalog) {
  return (failures || []).map((failure) => {
    const reference = repositoryReference(failure.repositoryId, proposalRepositories, repositoryCatalog);
    const detail = hideRepositoryIds(failure.errorDetail || 'Setup failed.', proposalRepositories, repositoryCatalog);
    return `${reference}: ${detail}`;
  }).join('\n');
}

export function hideWorkspaceRepositoryIds(text, proposalRepositories, repositoryCatalog) {
  return hideRepositoryIds(text, proposalRepositories, repositoryCatalog);
}
