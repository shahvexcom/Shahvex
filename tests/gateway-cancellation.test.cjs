const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Gateway } = require('../gateway/core.cjs');
const { AudioStream } = require('../gateway/audio-stream.cjs');
const config = { script: 'Accurate script', campaignId: 'fixture', direction: 'inbound', voiceId: 'fixture' };
function setup(extra = {}) {
  const logs = []; const g = new Gateway({ stt: async () => 'hello', llm: async () => 'reply', tts: async () => Buffer.alloc(640), voices: [{ id: 'fixture', verified: true }], log: e => logs.push(e), ...extra });
  return { g, logs, id: g.create('owner', config) };
}
for (const stage of ['stt', 'llm', 'tts', 'playback']) {
  test(`cancellation during ${stage} normalizes backend-specific abort errors and rejects stale history`, async () => {
    let entered; const ready = new Promise(r => { entered = r; });
    const block = signal => new Promise((_resolve, reject) => { entered(); signal.addEventListener('abort', () => reject(new TypeError('backend aborted differently')), { once: true }); });
    const extra = stage === 'playback' ? {} : stage === 'llm' ? {llm:(_messages,signal)=>block(signal)} : { [stage]: (...args) => block(args.at(-1)) };
    const { g, id, logs } = setup(extra);
    const turn = g.turn('owner', id, Buffer.alloc(640), 16000, stage === 'playback' ? (_chunk, _generation, signal) => block(signal) : undefined);
    const rejected = assert.rejects(turn, e => e.name === 'AbortError' && e.message === 'Cancelled');
    await ready; g.interrupt('owner', id); g.interrupt('owner', id); await rejected;
    assert.equal(logs.filter(e => e.stage === 'interrupt').length, 1);
    assert.equal(logs.filter(e => e.stage === 'turn-cancelled')[0].engineStage, stage);
    assert.equal(g.owned('owner', id).history.length, 0);
    await new Promise(r => setImmediate(r));
    assert.equal(g.queue.active, 0); assert.equal(g.queue.pending.length, 0); g.close('owner', id);
  });
}
test('continuous voiced frames yield one speech start; normal completion and close do not interrupt', async () => {
  const { g, id, logs } = setup(); const events = [];
  const stream = new AudioStream(g, 'owner', id, async e => events.push(e));
  const voiced = Buffer.alloc(640); for (let i = 0; i < 640; i += 2) voiced.writeInt16LE(2000, i);
  for (let i = 0; i < 30; i++) await stream.push(voiced);
  await stream.push(Buffer.alloc(6400)); await stream.end(); stream.close(); g.close('owner', id);
  assert.equal(events.filter(e => e.type === 'speech-start').length, 1);
  assert.equal(events.filter(e => e.type === 'turn-end').length, 1);
  assert.equal(logs.filter(e => e.stage === 'interrupt').length, 0);
});
test('genuine STT errors stay engine failures with stage diagnostics', async () => {
  const { g, id, logs } = setup({ stt: async () => { throw Error('fixture failure'); } });
  await assert.rejects(g.turn('owner', id, Buffer.alloc(640)), e => e.engineStage === 'stt' && e.name !== 'AbortError');
  assert.equal(logs.find(e => e.stage === 'turn-error').engineStage, 'stt');
});
