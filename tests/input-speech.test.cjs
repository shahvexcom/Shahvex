'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configureSpeech, suppressNoise, measureSpeech, speechDecision } =
  require('../deployment/vicidial-bridge/input-speech.cjs');

const config = configureSpeech();
function frame(amplitude) {
  const pcm = Buffer.alloc(320);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 4 ? amplitude : -amplitude, i);
  return pcm;
}
function decide(text, { amplitude = 6000, ms = 800, confidence = 0.9, speaking = true } = {}) {
  const gated = suppressNoise(frame(amplitude), config);
  const metrics = measureSpeech(Array(ms / 20).fill(gated));
  return speechDecision({ text, confidence }, metrics, config, speaking);
}

test('8 kHz noise at the reported peak cannot survive the RMS gate', () => {
  const { audio, voiced, level } = suppressNoise(frame(1350), config);
  assert.equal(voiced, false);
  assert.ok(level < -27 && level > -28);
  assert.deepEqual(audio, Buffer.alloc(320));
  assert.equal(decide("So we're talking about.", { amplitude: 1350 }).reason, 'below_energy_gate');
  assert.equal(suppressNoise(frame(8000), config).voiced, true);
  assert.equal(suppressNoise(frame(1350), configureSpeech({ gateDbfs: -30 })).voiced, true);
});

test('transcript quality is checked independently of the interruption duration', () => {
  assert.equal(decide('I have a question.', { confidence: 0.25 }).reason, 'low_confidence');
  for (const speaking of [true, false]) {
    assert.equal(decide("So we're talking about.", { amplitude: 2200, ms: 320, speaking }).reason, 'short_quiet_transcript');
  }
  assert.equal(decide('Why are you calling?', { ms: 780 }).reason, 'too_short_to_interrupt');
  assert.equal(decide('Why are you calling?').accepted, true);
  assert.equal(decide('Well, hello.', { ms: 1000 }).reason, 'too_few_words');
  assert.equal(decide('Yes.', { ms: 240, speaking: false }).accepted, true);
});

test('backchannels stay out of the floor and priority phrases bypass word count and duration', () => {
  assert.equal(decide('Yeah, okay, mm-hmm, uh-huh, well, so, right.').reason, 'backchannel');
  for (const text of ['No!', 'Stop.', 'Uh, wait.', 'I am not interested.', 'Don’t call me.']) {
    assert.equal(decide(text, { ms: 160 }).reason, 'priority_phrase', text);
    assert.equal(decide(text, { ms: 160, confidence: 0.2 }).reason, 'low_confidence', text);
  }
});
