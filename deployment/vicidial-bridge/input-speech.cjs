'use strict';

const { explicitlyEndsCall } = require('../../gateway/customer-conduct.cjs');

// PCM16 mono, 8 kHz. Measure in 20 ms blocks before upsampling for STT.
const defaults = Object.freeze({
  gateDbfs: -25,
  onsetMs: 120,
  endOfSpeechMs: 350,
  interruptionMs: 800,
  interruptionWords: 2,
  priorityProbeMs: 320,
  priorityProbeIntervalMs: 320,
  minConfidence: 0.55,
  shortSpeechMs: 450,
  shortSpeechDbfs: -22,
  debug: false,
});
const ranges = {
  gateDbfs: [-90, 0], onsetMs: [20, 500], endOfSpeechMs: [200, 1500],
  interruptionMs: [0, 5000], interruptionWords: [1, 20], minConfidence: [0, 1],
  priorityProbeMs: [120, 2000], priorityProbeIntervalMs: [200, 5000],
  shortSpeechMs: [0, 5000], shortSpeechDbfs: [-90, 0],
};
function configureSpeech(overrides) {
  const config = { ...defaults, ...overrides };
  for (const [name, [min, max]] of Object.entries(ranges)) {
    if (!Number.isFinite(config[name]) || config[name] < min || config[name] > max)
      throw Error(`Configure speech.${name} between ${min} and ${max}`);
  }
  if (!Number.isInteger(config.interruptionWords) || typeof config.debug !== 'boolean')
    throw Error('Configure an integer speech.interruptionWords and a boolean speech.debug');
  return config;
}

function power(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2) sum += pcm.readInt16LE(i) ** 2;
  return sum;
}
const dbfs = (sum, samples) => sum > 0 ? 10 * Math.log10(sum / samples / 32768 ** 2) : -Infinity;

function suppressNoise(pcm, config, preserveAudio = false) {
  const energy = power(pcm);
  const level = dbfs(energy, pcm.length / 2);
  const voiced = level >= config.gateDbfs;
  return { audio: voiced || preserveAudio ? pcm : Buffer.alloc(pcm.length), energy, level, voiced };
}

function measureSpeech(frames) {
  let sum = 0, samples = 0, durationMs = 0;
  for (const { audio, energy, voiced } of frames) {
    durationMs += audio.length / 16;
    if (voiced) {
      sum += energy;
      samples += audio.length / 2;
    }
  }
  return { dbfs: dbfs(sum, samples), voicedMs: samples / 8, durationMs };
}

const backchannels = new Set([
  'yeah', 'yep', 'yup', 'yes', 'okay', 'ok', 'mhm', 'uhhuh', 'well', 'so',
  'right', 'alright', 'sure', 'uh', 'um', 'erm', 'hm', 'hmm', 'mm', 'ah',
  'oh', 'umm', 'uhm', 'huh', 'hmmm', 'isee', 'ofcourse', 'absolutely', 'certainly', 'gotit', 'understood',
]);

function speechDecision(heard, audio, config, speaking) {
  const text = String(heard.text || '').toLowerCase().replace(/[’‘]/g, "'");
  const words = text.match(/[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu) || [];
  const normalized = words.join(' ');
  const content = normalized.replace(/\b(?:mm hmm|m hmm)\b/g, 'mhm')
    .replace(/\buh huh\b/g, 'uhhuh').replace(/\ball right\b/g, 'alright')
    .replace(/\bi see\b/g, 'isee').replace(/\bof course\b/g, 'ofcourse')
    .replace(/\bgot it\b/g, 'gotit').replace(/\bno (?:problem|worries)\b/g, 'okay').split(' ').filter(word => word && !backchannels.has(word));
  const priority = explicitlyEndsCall(heard.text) || /^(?:no|stop|wait)(?: |$)/.test(content.join(' ')) ||
    /\b(?:not interested|(?:don't|dont|do not) call)\b/.test(normalized);
  const result = { words: content.length, priority };
  if (!words.length) return { ...result, reason: 'empty_transcript' };
  if (Number.isFinite(heard.confidence) && heard.confidence < config.minConfidence)
    return { ...result, reason: 'low_confidence' };
  if (audio.voicedMs < config.onsetMs || audio.dbfs < config.gateDbfs)
    return { ...result, reason: 'below_energy_gate' };
  if (audio.voicedMs < config.shortSpeechMs && audio.dbfs < config.shortSpeechDbfs)
    return { ...result, reason: 'short_quiet_transcript' };
  if (speaking && !priority) {
    if (!content.length) return { ...result, trusted: true, reason: 'backchannel' };
    if (content.length < config.interruptionWords) return { ...result, trusted: true, reason: 'too_few_words' };
    if (audio.voicedMs < config.interruptionMs) return { ...result, trusted: true, reason: 'too_short_to_interrupt' };
  }
  return { ...result, trusted: true, accepted: true, reason: priority ? 'priority_phrase' : 'qualified_speech' };
}

module.exports = { configureSpeech, suppressNoise, measureSpeech, speechDecision };
