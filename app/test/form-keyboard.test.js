import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { bindEnterToSubmit } from '../src/form-keyboard.js';

function setup() {
  const window = new Window();
  window.document.body.innerHTML = '<form><textarea></textarea><button type="submit">Go</button></form>';
  const form = window.document.querySelector('form');
  const textarea = form.querySelector('textarea');
  let submissions = 0;
  form.addEventListener('submit', (event) => { event.preventDefault(); submissions++; });
  const dispose = bindEnterToSubmit(form);
  return { window, form, textarea, submissions: () => submissions, dispose };
}

function keydown(window, textarea, options = {}) {
  const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
  textarea.dispatchEvent(event);
  return event;
}

test('Enter submits the textarea form once', () => {
  const state = setup();
  const event = keydown(state.window, state.textarea);
  assert.equal(event.defaultPrevented, true);
  assert.equal(state.submissions(), 1);
  state.dispose();
  state.window.close();
});

test('Shift+Enter keeps the browser newline behavior without submitting', () => {
  const state = setup();
  const event = keydown(state.window, state.textarea, { shiftKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(state.submissions(), 0);
  state.dispose();
  state.window.close();
});

test('Enter used by IME composition does not submit', () => {
  const state = setup();
  const event = keydown(state.window, state.textarea, { isComposing: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(state.submissions(), 0);
  state.dispose();
  state.window.close();
});

test('disabled submission and readonly textareas are not submitted by Enter', () => {
  const state = setup();
  state.form.querySelector('button').disabled = true;
  assert.equal(keydown(state.window, state.textarea).defaultPrevented, false);
  state.form.querySelector('button').disabled = false;
  state.textarea.readOnly = true;
  assert.equal(keydown(state.window, state.textarea).defaultPrevented, false);
  assert.equal(state.submissions(), 0);
  state.dispose();
  state.window.close();
});
