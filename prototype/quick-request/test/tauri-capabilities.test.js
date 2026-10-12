import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const capabilities = JSON.parse(
  readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
);

test('main window can listen for and unlisten from PTY output events', () => {
  assert.deepEqual(capabilities.windows, ['main']);
  assert.ok(capabilities.permissions.includes('core:event:allow-listen'));
  assert.ok(capabilities.permissions.includes('core:event:allow-unlisten'));
});
