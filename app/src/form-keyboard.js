// Submit multiline form prompts with Enter while preserving Shift+Enter for
// newline insertion. Keep submission on the form's native validation path.
export function bindEnterToSubmit(form) {
  const onKeyDown = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    if (!(event.target instanceof form.ownerDocument.defaultView.HTMLTextAreaElement)) return;
    if (!form.contains(event.target) || event.target.readOnly || event.target.disabled) return;
    const submitter = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitter?.disabled) return;

    event.preventDefault();
    form.requestSubmit();
  };

  form.addEventListener('keydown', onKeyDown);
  return () => form.removeEventListener('keydown', onKeyDown);
}
