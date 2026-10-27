import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSessionTabKeydown } from '../src/session-tab-keyboard.js';

function keyboardFixture() {
  const calls = [];
  const entries = ['a', 'other-owner', 'disabled', 'b', 'c'].map((sessionId) => ({
    sessionId, visible: sessionId !== 'other-owner', disabled: sessionId === 'disabled',
    onSelect: () => calls.push(['select', sessionId]),
  }));
  let activeSessionId = 'a';
  return {
    entries, calls,
    press(key, active = activeSessionId, overrides = {}) {
      const event = { key, preventDefault() { this.defaultPrevented = true; }, ...overrides };
      handleSessionTabKeydown(event, entries, {
        activeSessionId: active,
        focusTab: (id) => { activeSessionId = id; calls.push(['focus', id]); },
      });
      return event;
    },
  };
}

test('session tab keys use visible enabled records, focus before selection, wrap, and handle Home/End', () => {
  const fixture = keyboardFixture();
  const { press, calls } = fixture;
  for (const [key, active, expected] of [
    ['ArrowRight', 'a', 'b'], ['ArrowDown', 'c', 'a'],
    ['ArrowLeft', 'a', 'c'], ['ArrowUp', 'b', 'a'],
    ['Home', 'c', 'a'], ['End', 'a', 'c'],
    ['ArrowRight', 'not-a-tab', 'b'],
  ]) {
    calls.length = 0;
    assert.equal(press(key, active).defaultPrevented, true);
    assert.deepEqual(calls, [['focus', expected], ['select', expected]]);
  }
  // Owner changes hide wrappers in JSX; keyboard membership comes from the same
  // records, never from whether the button itself has a hidden attribute.
  fixture.entries.forEach((entry) => { entry.visible = entry.sessionId === 'other-owner'; });
  calls.length = 0;
  press('End', 'a');
  assert.deepEqual(calls, [['focus', 'other-owner'], ['select', 'other-owner']]);
});

test('unhandled, composing, disabled, prevented, and empty tab events do nothing', () => {
  const { press, entries, calls } = keyboardFixture();
  for (const [key, overrides] of [
    ['x', {}], ['Enter', {}], ['ArrowRight', { isComposing: true }],
    ['End', { keyCode: 229 }], ['Home', { target: { disabled: true } }],
    ['ArrowDown', { defaultPrevented: true }],
  ]) {
    assert.equal(Boolean(press(key, 'a', overrides).defaultPrevented), Boolean(overrides.defaultPrevented));
    assert.deepEqual(calls, []);
  }
  entries.forEach((entry) => { entry.visible = false; });
  assert.equal(press('End').defaultPrevented, undefined);
  assert.deepEqual(calls, []);
});
