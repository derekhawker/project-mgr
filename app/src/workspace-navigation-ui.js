export function createWorkspaceNavigationButton(document, workspace, {
  repositoryCount = 0,
  selected = false,
  onSelect = () => {},
} = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `workspace-navigation-button${selected ? ' selected' : ''}`;
  button.setAttribute('aria-label', repositoryCount
    ? `${workspace.name}, ${repositoryCount} ${repositoryCount === 1 ? 'repository' : 'repositories'}`
    : workspace.name);
  const name = document.createElement('span');
  name.textContent = workspace.name;
  button.append(name);
  if (repositoryCount > 0) {
    const icon = document.createElement('span');
    icon.className = 'workspace-repository-indicator';
    icon.setAttribute('aria-hidden', 'true');
    icon.title = `${repositoryCount} associated Git ${repositoryCount === 1 ? 'repository' : 'repositories'}`;
    icon.innerHTML = '<svg viewBox="0 0 16 16" focusable="false"><path d="M5 3v10m6-10v3a2 2 0 0 1-2 2H7a2 2 0 0 0-2 2m6-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>';
    button.append(icon);
  }
  button.addEventListener('click', onSelect);
  return button;
}
