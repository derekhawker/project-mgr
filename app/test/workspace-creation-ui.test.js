import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { revealWorkspaceCreationRecovery } from '../src/workspace-creation-ui.js';

test('Workspace setup failure leaves its recovery details visible in the open review modal', () => {
  const window = new Window();
  const { document } = window;
  document.body.innerHTML = `
    <dialog open>
      <section id="new-work" hidden>Original prompt form</section>
      <section id="review" hidden>
        <h1>Review New Workspace</h1>
        <p id="error"></p>
        <button id="create">Create Workspace</button>
      </section>
    </dialog>`;
  const dialog = document.querySelector('dialog');
  const newWork = document.querySelector('#new-work');
  const review = document.querySelector('#review');
  const errorElement = document.querySelector('#error');
  const createButton = document.querySelector('#create');

  revealWorkspaceCreationRecovery({
    dialog,
    newWork,
    review,
    errorElement,
    createButton,
    message: 'Repository source changed or became dirty after review.',
    actionLabel: 'Retry setup',
  });

  assert.equal(dialog.open, true);
  assert.equal(newWork.hidden, true);
  assert.equal(review.hidden, false);
  assert.equal(errorElement.textContent, 'Repository source changed or became dirty after review.');
  assert.equal(createButton.textContent, 'Retry setup');
});
