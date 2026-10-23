import assert from 'node:assert/strict';
import test from 'node:test';
import { filterQuickRequests } from '../src/quick-request-search.js';

const records = [
  { task: { id: 'one' }, prompt: 'Compare API approaches' },
  { task: { id: 'two' }, prompt: 'Review dependency update' },
  { task: { id: 'three' }, prompt: null },
];

test('Quick Request search uses a trimmed, case-insensitive literal substring of the original prompt', () => {
  assert.deepEqual(filterQuickRequests(records, '  API  '), [records[0]]);
  assert.deepEqual(filterQuickRequests(records, 'API.*'), []);
  assert.deepEqual(filterQuickRequests(records, '   '), records);
});

test('Quick Request search does not exclude records whose prompt is unavailable', () => {
  assert.deepEqual(filterQuickRequests(records, 'prompt unavailable'), [records[2]]);
});
