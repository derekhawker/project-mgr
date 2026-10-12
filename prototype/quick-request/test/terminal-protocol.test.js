import assert from 'node:assert/strict';
import test from 'node:test';
import xterm from '@xterm/xterm';
import { registerXtGetTcapHandler } from '../src/terminal-protocol.js';

test('answers XTGETTCAP requests using xterm.js DCS parsing', async () => {
  const terminal = new xterm.Terminal();
  const replies = [];
  registerXtGetTcapHandler(terminal, (reply) => replies.push(reply));

  try {
    await new Promise((resolve) => terminal.write('\x1bP+q4d73\x1b\\', resolve));
    assert.deepEqual(replies, ['\x1bP0+r4d73\x1b\\']);
  } finally {
    terminal.dispose();
  }
});
