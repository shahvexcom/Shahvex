const assert = require('node:assert/strict');
const { test } = require('node:test');
const { initialAudio } = require('../deployment/vicidial-bridge/initial-audio.cjs');

async function feed(guard, pcm) {
  for (let now = 32; now < 30000; now += 32) {
    guard.receive(pcm, now);
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('initial caller PCM distinguishes sustained digital silence from missing media', async () => {
  const silent = initialAudio(0, async () => 0);
  await feed(silent, Buffer.alloc(512));
  assert.equal(silent.evaluate(29999), undefined);
  assert.deepEqual(silent.evaluate(30003), {
    result:'no_speech_timeout', audioMs:29984, decisionDelayMs:3, speech:false, modelUncertain:false, maxProbability:0
  });
  assert.equal(silent.evaluate(30100), undefined);
  assert.equal(initialAudio(0, async () => 0).evaluate(30000).result, 'missing_pcm');
});

test('quiet signal, recognized speech, and failed VAD preserve the call', async () => {
  const quiet = initialAudio(0, async () => 0.27);
  const waveform = Buffer.alloc(512,1);
  await feed(quiet, waveform);
  assert.equal(quiet.evaluate(30000).result, 'preserve');
  const recognized = initialAudio(0, async () => 0);
  await feed(recognized, Buffer.alloc(512));
  recognized.recognize();
  assert.equal(recognized.evaluate(30000).result, 'preserve');
  const failed = initialAudio(0, async () => { throw Error('worker unavailable'); });
  await feed(failed, Buffer.alloc(512));
  assert.equal(failed.evaluate(30000).result, 'preserve');
});

test('one nonzero frame does not veto termination', async () => {
  const guard = initialAudio(0, async () => 0);
  await feed(guard, Buffer.alloc(512));
  const quiet = Buffer.alloc(512);
  quiet.writeInt16LE(1, 0);
  guard.receive(quiet, 30004);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(guard.evaluate(30008).result, 'no_speech_timeout');
});
