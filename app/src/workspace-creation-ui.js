export function revealWorkspaceCreationRecovery({
  dialog,
  newWork,
  review,
  errorElement,
  createButton,
  message,
  actionLabel,
}) {
  newWork.hidden = true;
  review.hidden = false;
  dialog.classList.add('proposal-open');
  errorElement.textContent = message;
  createButton.textContent = actionLabel;
}
