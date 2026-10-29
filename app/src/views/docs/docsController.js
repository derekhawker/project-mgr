import { loadDocs, readDoc } from "../../services/docsUi.js";

function ownerKey(owner) {
  return owner ? `${owner.type}:${owner.id}` : null;
}

export function createDocsController({ invoke, getOwner, onOpen, view: ui }) {
  const currentOwnerKey = () => ownerKey(getOwner());
  let cached = null;
  let selectionVersion = 0;

  async function select(owner, documentPath) {
    const requestedKey = ownerKey(owner);
    const version = ++selectionVersion;
    ui.setSelected(documentPath);
    ui.setContentMessage("Loading document…");
    try {
      const documentRecord = await readDoc(
        invoke,
        owner.type,
        owner.id,
        documentPath,
      );
      if (currentOwnerKey() !== requestedKey || version !== selectionVersion)
        return;
      ui.setContent(documentRecord);
    } catch (error) {
      if (currentOwnerKey() !== requestedKey || version !== selectionVersion)
        return;
      ui.setContentMessage(`Could not load document: ${String(error)}`);
    }
  }

  async function refresh(owner = getOwner()) {
    if (!owner) {
      ui.setButtonDisabled(true);
      return;
    }
    ui.setButtonDisabled(true);
    try {
      const files = await loadDocs(invoke, owner.type, owner.id);
      if (currentOwnerKey() === ownerKey(owner)) {
        cached = { ownerKey: ownerKey(owner), files };
        ui.setButtonDisabled(files.length === 0);
      }
    } catch {
      // Discovery failure is not evidence that there are no documents. Keep the
      // tab enabled so the user can open the centered error state and retry.
      if (currentOwnerKey() === ownerKey(owner)) {
        cached = null;
        ui.setButtonDisabled(false);
      }
    }
  }

  async function open() {
    const owner = getOwner();
    if (!owner) return;
    const requestedKey = ownerKey(owner);
    ui.setButtonDisabled(true);
    ui.setButtonSelected(true);
    onOpen();
    ui.setPageVisible(true);
    ui.setPageMessage("Loading documents…");
    try {
      const files =
        cached?.ownerKey === requestedKey
          ? cached.files
          : await loadDocs(invoke, owner.type, owner.id);
      if (currentOwnerKey() !== requestedKey) return;
      if (!files.length) {
        cached = { ownerKey: requestedKey, files };
        ui.setPageMessage("No Markdown or text files were found.");
        ui.setButtonDisabled(true);
        return;
      }
      cached = { ownerKey: requestedKey, files };
      ui.setFiles(files);
      await select(owner, files[0]);
      if (currentOwnerKey() === requestedKey) ui.setButtonDisabled(false);
    } catch (error) {
      if (currentOwnerKey() !== requestedKey) return;
      ui.setPageMessage(`Could not load documents: ${String(error)}`);
      ui.setButtonDisabled(false);
    }
  }

  return {
    open,
    refresh,
    select(path, repositoryId = null) {
      const owner = getOwner();
      if (!owner) return Promise.resolve();
      return select(owner, { path, repositoryId });
    },
    showTerminal() {
      ui.setPageVisible(false);
      ui.setButtonSelected(false);
    },
  };
}
