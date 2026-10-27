import { createSignal } from 'solid-js';

// Transient reader presentation shared by the production pane and controller.
export function createDocsView() {
  const [visible, setPageVisible] = createSignal(false);
  const [buttonSelected, setButtonSelected] = createSignal(false);
  const [buttonDisabled, setButtonDisabled] = createSignal(true);
  const [files, setFileList] = createSignal([]);
  const [pageMessage, setMessage] = createSignal('');
  const [selected, setSelected] = createSignal(null);
  const [content, setRecord] = createSignal(null);
  const [contentMessage, setRecordMessage] = createSignal('Select a document.');
  return {
    visible, buttonSelected, buttonDisabled, files, pageMessage, selected, content, contentMessage,
    setPageVisible, setButtonSelected, setButtonDisabled, setSelected,
    setPageMessage(message) {
      if (message) setFileList([]);
      setMessage(message);
    },
    setFiles(records) { setFileList(records); setMessage(''); },
    setContent(record) { setRecordMessage(''); setRecord(record); },
    setContentMessage(message) { setRecord(null); setRecordMessage(message); },
  };
}
