'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const { loadSilero } = require('./initial-audio.cjs');
const { isVoicemailGreeting } = require('../../gateway/voicemail-detection.cjs');

const { config, model, runtime } = workerData;
const calls = new Map();
const frameMs = 32;
const frameBytes = 512;
const humanGreeting = new RegExp(config.humanGreeting, 'iu');
const normalize = text => text.normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

function spectrum(frame) {
  let energy = 0;
  let crossings = 0;
  let previous = 0;
  for (let i = 0; i < frameBytes; i += 2) {
    const value = frame.readInt16LE(i);
    energy += value * value;
    if ((value >= 0) !== (previous >= 0)) crossings++;
    previous = value;
  }
  if (energy < 256 * config.minSignalRms ** 2) return { tone: 0, tonal: false, quiet: true, loud: false };
  const estimate = crossings * 8000 / 512;
  const center = Math.round(estimate / 31.25) * 31.25;
  let peak = 0;
  let tone = 0;
  for (const frequency of [center - 31.25, center, center + 31.25]) {
    if (frequency < config.beepMinHz - 31.25 || frequency > config.beepMaxHz + 31.25) continue;
    const coefficient = 2 * Math.cos(2 * Math.PI * frequency / 8000);
    let a = 0;
    let b = 0;
    for (let i = 0; i < frameBytes; i += 2) {
      const value = frame.readInt16LE(i) + coefficient * a - b;
      b = a;
      a = value;
    }
    const purity = (a * a + b * b - coefficient * a * b) / (128 * energy);
    if (purity > peak) { peak = purity; tone = frequency; }
  }
  return { tone: peak >= config.beepPurity ? tone : 0, tonal: peak >= config.tonalPurity, quiet: false, loud: energy >= 256 * config.loudNonSpeechRms ** 2 };
}

function emit(call, event, fields = {}) {
  parentPort.postMessage({ id: call.id, event, ...fields });
}

function decision(call, classification, confidence, signal, final = false) {
  call.candidate = { classification, confidence, signal };
  emit(call, final ? 'decision' : 'candidate', {
    ...call.candidate, latencyMs: Math.round(performance.now() - call.start),
    signals: [...call.signals, signal],
  });
  if (final) calls.delete(call.id);
}

function signal(call, name) {
  if (call.signals.has(name)) return;
  call.signals.add(name);
  emit(call, 'signal', { signal: name });
}

async function audio(call, pcm, at) {
  call.tail = Buffer.concat([call.tail, Buffer.from(pcm)]);
  while (call.tail.length >= frameBytes && calls.has(call.id)) {
    const frame = call.tail.subarray(0, frameBytes);
    call.tail = call.tail.subarray(frameBytes);
    call.observedPcmMs = (call.observedPcmMs || 0) + frameMs;
    const probability = await call.score(frame);
    if (!calls.has(call.id)) return;
    if (config.debugVad && (!call.lastVadLog || at - call.lastVadLog >= config.vadLogMs)) {
      call.lastVadLog = at;
      emit(call, 'vad', { probability: Number(probability.toFixed(3)) });
    }
    const sample = spectrum(frame);
    call.weakVoice = probability > config.vadUncertainProbability && !sample.quiet ? (call.weakVoice || 0) + 1 : 0;
    call.loudMs = sample.loud ? (call.loudMs || 0) + frameMs : 0;
    if (call.loudMs >= config.loudNonSpeechMs) signal(call, 'sustained_loud_audio');
    if ((call.weakVoice >= config.vadUncertainConsecutive ||
         probability > config.vadUncertainPeak) && !call.uncertainVoice) {
      call.uncertainVoice = true;
      signal(call, 'possible_speech');
    }
    call.voiced = probability > config.vadProbability && !sample.quiet ? call.voiced + 1 : 0;
    if (call.voiced >= config.vadConsecutive) {
      if (!call.speech) {
        call.speech = true;
        call.firstSpeech = at;
        signal(call, 'speech_detected');
      }
      if (call.lastSpeech && at - call.lastSpeech >= config.pauseMs &&
          at - call.lastSpeech <= config.replyWindowMs &&
          call.lastSpeech - call.firstSpeech < config.shortGreetingMs) {
        call.shortTurns = true;
      }
      call.lastSpeech = at;
      call.speechMs += frameMs;
      call.runMs += frameMs;
      if (call.runMs >= config.longGreetingMs && !call.signals.has('long_utterance')) {
        signal(call, 'long_utterance');
        decision(call, 'VOICEMAIL', 0.65, 'long_utterance', 0.65 >= config.hangupConfidence);
      }
    } else if (call.lastSpeech && at - call.lastSpeech >= config.pauseMs) {
      call.runMs = 0;
    }
    if (!sample.quiet) {
      call.audibleMs += frameMs;
      call.tonalMs += sample.tonal ? frameMs : 0;
    }
    if (call.speech && sample.tone && Math.abs(sample.tone - call.tone) <= 31.25) {
      call.toneMs += frameMs;
    } else {
      call.tone = sample.tone;
      call.toneMs = sample.tone ? frameMs : 0;
    }
    if (call.speechMs >= 500 && call.lastSpeech && at - call.lastSpeech < 2000 &&
        call.toneMs >= config.beepMs && !call.signals.has('beep_detected')) {
      signal(call, 'beep_detected');
      const corroborated = !call.shortTurns && call.speechMs >= config.beepGreetingMs && call.weakPrompt;
      const confidence = corroborated ? 0.99 : 0.86;
      decision(call, 'VOICEMAIL', confidence, 'beep_detected', corroborated || confidence >= config.hangupConfidence);
    }
    if (call.audibleMs >= config.backgroundMs && call.tonalMs / call.audibleMs >= config.backgroundTonalRatio &&
        !call.shortTurns && !call.signals.has('background_audio')) {
      signal(call, 'background_audio');
      decision(call, 'TV/BACKGROUND', 0.75, 'background_audio', 0.75 >= config.hangupConfidence);
    }
  }
}

function transcript(call, text, at) {
  const clean = normalize(text);
  if (!clean) return;
  const matched = config.keywords.find(keyword => ` ${clean} `.includes(` ${normalize(keyword)} `));
  const possiblePrompt = Boolean(matched || isVoicemailGreeting(text, call.recent));
  const conversational = /^(?:i (?:said|heard|wanted)|you (?:said|heard)|did you|can you|could you|what|why|how)\b/i.test(clean);
  if (possiblePrompt && !conversational) {
    signal(call, 'keyword_matched');
    return decision(call, 'VOICEMAIL', 0.99, 'keyword_matched', true);
  }
  call.weakPrompt ||= /\b(?:mailbox|voicemail|beep|subscriber|after the tone)\b/i.test(clean);
  call.recent = [...call.recent, text].slice(-3);
  call.lastTranscript = at;
  call.transcripts++;
  if (humanGreeting.test(text.trim())) signal(call, 'short_greeting');
  if ((call.shortTurns || (call.playbackEnded && at - call.playbackEnded <= config.replyWindowMs)) &&
      (call.transcripts >= 2 || call.signals.has('short_greeting'))) {
    decision(call, 'HUMAN', 0.99, 'interactive_turn', true);
  }
}

async function run() {
  const scorer = await loadSilero(model, runtime ? require(runtime) : undefined);
  await scorer()(Buffer.alloc(frameBytes));
  parentPort.on('message', ({ id, type, pcm, at, text, start, weight }) => {
    if (type === 'start') {
      calls.set(id, { id, start, mediaStart: performance.now(), score: scorer(), tail: Buffer.alloc(0), pending: 0,
        chain: Promise.resolve(), recent: [], signals: new Set(), voiced: 0, speechMs: 0,
        runMs: 0, toneMs: 0, audibleMs: 0, tonalMs: 0, transcripts: 0 });
      return;
    }
    const call = calls.get(id);
    if (!call) return;
    if (type === 'stop') {
      calls.delete(id);
      return;
    }
    call.pending++;
    call.chain = call.chain.then(async () => {
      if (!calls.has(id)) return;
      if (type === 'connected') call.start = Math.min(call.start, at);
      if (type === 'audio') await audio(call, pcm, at);
      if (type === 'transcript') transcript(call, text, at);
      if (type === 'transcript_evidence') call.transcriptEvidence = true;
      if (type === 'masked') {
        call.tail = Buffer.alloc(0);
        call.voiced = call.runMs = call.toneMs = call.weakVoice = call.loudMs = 0;
        call.maskedSince ??= at;
      }
      if (type === 'unmasked') {
        call.playbackEnded = at;
        if (call.maskedSince !== undefined) {
          call.maskedMs = (call.maskedMs || 0) + at - call.maskedSince;
          call.maskedSince = undefined;
        }
      }
    }).catch(() => {
      emit(call, 'error', { reason: 'classifier_exception' });
      calls.delete(id);
    }).finally(() => {
      call.pending--;
      emit(call, 'ack', { weight });
    });
  });
  setInterval(() => {
    const now = performance.now();
    for (const call of calls.values()) {
      if (call.pending) continue;
      const age = now - call.mediaStart;
      const inactive = now - Math.max(call.mediaStart, call.lastSpeech || 0, call.lastTranscript || 0);
      if (age < config.maxObservationMs && inactive < config.silenceMs) continue;
      if (call.candidate?.classification === 'TV/BACKGROUND') {
        decision(call, call.candidate.classification, call.candidate.confidence, call.candidate.signal, true);
        continue;
      }
      if (inactive < config.silenceMs || call.candidate?.classification === 'VOICEMAIL') {
        decision(call, 'UNDETERMINED', 0, 'insufficient_confirmation', true);
        continue;
      }
      const masked = (call.maskedMs || 0) + (call.maskedSince === undefined ? 0 : now - call.maskedSince);
      if (call.speech || call.transcripts) {
        decision(call, config.HANGUP_ON_SILENCE_AFTER_SPEECH ? 'SILENCE' : 'UNDETERMINED',
          config.HANGUP_ON_SILENCE_AFTER_SPEECH ? 0.99 : 0, 'inactive_after_speech', true);
      } else if (!call.observedPcmMs || masked >= config.maxMaskedSilenceMs || call.uncertainVoice ||
                 call.signals.has('sustained_loud_audio')) {
        const reason = !call.observedPcmMs ? 'no_observed_pcm'
          : call.uncertainVoice ? 'possible_speech'
          : call.signals.has('sustained_loud_audio') ? 'sustained_loud_audio' : 'playback_coverage_gap';
        decision(call, 'UNDETERMINED', 0, reason, true);
      } else if (call.transcriptEvidence || call.observedPcmMs < age * 0.8) {
        // A wall-clock timeout can include playback, transport gaps, or time before inbound media.
        decision(call, 'UNDETERMINED', 0,
          call.transcriptEvidence ? 'transcript_speech_evidence' : 'insufficient_pcm_coverage', true);
      } else {
        decision(call, 'SILENCE', 0.99, 'no_speech', true);
      }
    }
  }, config.tickMs);
  parentPort.postMessage({ event: 'ready' });
}

run().catch(error => parentPort.postMessage({ event: 'error', reason: 'silero_initialization_failed', detail: error.message }));
