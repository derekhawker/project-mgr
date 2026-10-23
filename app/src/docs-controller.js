import {
  loadDocs,
  readDoc,
  renderDocContent,
  renderDocContentMessage,
  renderDocs,
  renderDocsMessage,
  selectDocPath,
} from './docs-ui.js';

function ownerKey(owner) {
  return owner ? `${owner.type}:${owner.id}` : null;
}

export function createDocsController({ button, page, invoke, getOwner, onOpen }) {
  const currentOwnerKey = () => ownerKey(getOwner());
  let cached = null;
  let selectionVersion = 0;

  async function select(owner, documentPath) {
    const requestedKey = ownerKey(owner);
    const version = ++selectionVersion;
    selectDocPath(page, documentPath);
    renderDocContentMessage(page, 'Loading document…');
    try {
      const documentRecord = await readDoc(invoke, owner.type, owner.id, documentPath);
      if (currentOwnerKey() !== requestedKey || version !== selectionVersion) return;
      renderDocContent(page, documentRecord);
    } catch (error) {
      if (currentOwnerKey() !== requestedKey || version !== selectionVersion) return;
      renderDocContentMessage(page, `Could not load document: ${String(error)}`);
    }
  }

  async function refresh(owner = getOwner()) {
    if (!owner) {
      button.disabled = true;
      return;
    }
    button.disabled = true;
    try {
      const files = await loadDocs(invoke, owner.type, owner.id);
      if (currentOwnerKey() === ownerKey(owner)) {
        cached = { ownerKey: ownerKey(owner), files };
        button.disabled = files.length === 0;
      }
    } catch {
      // Discovery failure is not evidence that there are no documents. Keep the
      // tab enabled so the user can open the centered error state and retry.
      if (currentOwnerKey() === ownerKey(owner)) {
        cached = null;
        button.disabled = false;
      }
    }
  }

  async function open() {
    const owner = getOwner();
    if (!owner) return;
    const requestedKey = ownerKey(owner);
    button.disabled = true;
    button.classList.add('selected');
    onOpen();
    page.hidden = false;
    renderDocsMessage(page, 'Loading documents…');
    try {
      const files = cached?.ownerKey === requestedKey
        ? cached.files
        : await loadDocs(invoke, owner.type, owner.id);
      if (currentOwnerKey() !== requestedKey) return;
      if (!files.length) {
        cached = { ownerKey: requestedKey, files };
        renderDocsMessage(page, 'No Markdown or text files were found.');
        button.disabled = true;
        return;
      }
      cached = { ownerKey: requestedKey, files };
      renderDocs(page, files, (documentPath) => { void select(owner, documentPath); });
      await select(owner, files[0]);
      if (currentOwnerKey() === requestedKey) button.disabled = false;
    } catch (error) {
      if (currentOwnerKey() !== requestedKey) return;
      renderDocsMessage(page, `Could not load documents: ${String(error)}`);
      button.disabled = false;
    }
  }

  button.addEventListener('click', () => { void open(); });

  return {
    open,
    refresh,
    select(path, repositoryId = null) {
      const owner = getOwner();
      if (!owner) return Promise.resolve();
      return select(owner, { path, repositoryId });
    },
    showTerminal() {
      page.hidden = true;
      button.classList.remove('selected');
    },
  };
}
