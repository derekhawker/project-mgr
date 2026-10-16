import { preferredTaskWorkspaceId, taskWorkspaceOptions } from './shell.js';

export function populateTaskWorkspaceSelector(select, workspaces, preferredId = null) {
  const document = select.ownerDocument;
  const placeholder = Object.assign(document.createElement('option'), {
    value: '',
    textContent: 'Choose a workspace',
  });
  const options = taskWorkspaceOptions(workspaces).map(({ id, name }) => Object.assign(
    document.createElement('option'),
    { value: id, textContent: name },
  ));
  select.replaceChildren(placeholder, ...options);
  select.value = preferredTaskWorkspaceId(workspaces, preferredId);
  return select.value || null;
}

export function bindWorkspaceContextMenu(button, workspace, openMenu) {
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openMenu(workspace, event.clientX, event.clientY, button);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const bounds = button.getBoundingClientRect();
    openMenu(workspace, bounds.left, bounds.bottom, button);
  });
}
