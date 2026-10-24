import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createWorkspaceNavigationButton } from '../src/workspace-navigation-ui.js';

test('workspace navigation selects the workspace and shows its repository count without task actions', () => {
  const window = new Window();
  const workspace = { id: 'workspace-a', name: 'Alpha' };
  let selected = 0;
  const button = createWorkspaceNavigationButton(window.document, workspace, {
    repositoryCount: 2,
    onSelect: () => { selected += 1; },
  });

  assert.equal(button.querySelector('.workspace-repository-indicator')?.title, '2 associated Git repositories');
  assert.equal(button.getAttribute('aria-label'), 'Alpha, 2 repositories');
  assert.equal(button.hasAttribute('aria-haspopup'), false);
  button.click();
  assert.equal(selected, 1);
  window.close();
});
