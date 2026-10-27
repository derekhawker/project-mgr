import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewWorkDialogController } from '../src/new-work-dialog-controller.js';

function setup(session = null, failClose = false) {
  const calls = [];
  const controller = createNewWorkDialogController({
    getProposalSessionId: () => session,
    setRequestedType: (v) => calls.push(['requested', v]), setWorkType: (v) => calls.push(['type', v]),
    setView: (v) => calls.push(['view', v]), setPrompt: (v) => calls.push(['prompt', v]),
    setCaptureError: (v) => calls.push(['error', v]), dialog: { isOpen: () => false, showModal: () => calls.push(['show']), close: () => calls.push(['close']) },
    focusPrompt: () => calls.push(['focus']), closeProposalSession: async () => { calls.push(['cleanup']); if (failClose) throw Error(); },
  });
  return { controller, calls };
}

test('open accepts work types and ignores invalid types', () => {
  const { controller, calls } = setup();
  controller.open('invalid'); assert.deepEqual(calls, []);
  controller.open('quick_request');
  assert.deepEqual(calls, [['requested','quick_request'],['type','quick_request'],['view','capture'],['prompt',''],['error',''],['show'],['focus']]);
});

test('cancel closes after cleanup, but remains open when cleanup fails', async () => {
  const ok = setup('proposal'); await ok.controller.cancel();
  assert.deepEqual(ok.calls, [['cleanup'],['view','closed'],['close']]);
  const failed = setup('proposal', true); await failed.controller.cancel();
  assert.deepEqual(failed.calls, [['cleanup']]);
});

test('Escape prevents native cancel and runs cleanup before closing', async () => {
  const { controller, calls } = setup();
  let prevented = false; controller.handleCancelEvent({ preventDefault() { prevented = true; } });
  await Promise.resolve(); assert.equal(prevented, true); assert.deepEqual(calls, [['view','closed'],['close']]);
});

test('back returns to capture and focuses prompt', () => {
  const { controller, calls } = setup(); controller.backToCapture();
  assert.deepEqual(calls, [['view','capture'],['focus']]);
});
