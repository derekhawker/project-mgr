import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { bindWorkspaceContextMenu, populateTaskWorkspaceSelector } from '../src/task-workspace-ui.js';

test('Task workspace selector lists eligible workspaces, preselects context, and remains changeable', () => {
  const window = new Window();
  const select = window.document.createElement('select');
  const workspaces = [
    { id: 'workspace-a', name: 'Alpha', kind: 'regular', status: 'active' },
    { id: 'workspace-b', name: 'Beta', kind: 'regular', status: 'completed' },
    { id: 'workspace-quick', name: 'Quick Requests', kind: 'quick_requests', status: 'active' },
  ];

  assert.equal(populateTaskWorkspaceSelector(select, workspaces, 'workspace-a'), 'workspace-a');
  assert.deepEqual([...select.options].map(({ value, textContent }) => [value, textContent]), [
    ['', 'Choose a workspace'],
    ['workspace-a', 'Alpha'],
  ]);
  select.value = '';
  assert.equal(select.value, '');
  assert.equal(populateTaskWorkspaceSelector(select, workspaces), null);
  window.close();
});

test('Workspace context action opens by right-click and keyboard context-menu keys', () => {
  const window = new Window();
  const button = window.document.createElement('button');
  const workspace = { id: 'workspace-a', name: 'Alpha', kind: 'regular', status: 'active' };
  const opened = [];
  bindWorkspaceContextMenu(button, workspace, (...args) => opened.push(args));

  const rightClick = new window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 60,
    clientY: 90,
  });
  button.dispatchEvent(rightClick);
  assert.equal(rightClick.defaultPrevented, true);
  assert.deepEqual(opened, [[workspace, 60, 90, button]]);

  button.dispatchEvent(new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'F10',
    shiftKey: true,
  }));
  assert.deepEqual(opened[1], [
    workspace,
    button.getBoundingClientRect().left,
    button.getBoundingClientRect().bottom,
    button,
  ]);
  window.close();
});
