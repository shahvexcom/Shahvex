'use strict';

const sampleRate = 8000;
const frameSamples = 256;
const contextSamples = 32;
const noCustomerSpeechMs = 30000;

function speechBlock(pcm, probability) {
  if (probability < 0.12) return false;
  let signalSamples = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    if (pcm.readInt16LE(i) !== 0) signalSamples++;
  }
  return signalSamples >= 16;
}

async function hasSpeech(pcm, score) {
  let consecutive = 0;
  for (let offset = 0; offset + frameSamples * 2 <= pcm.length; offset += frameSamples * 2) {
    const frame = pcm.subarray(offset, offset + frameSamples * 2);
    const probability = await score(frame);
    consecutive = probability >= 0.20 && speechBlock(frame, probability) ? consecutive + 1 : 0;
    if (consecutive >= 2) return true;
  }
  return false;
}

// The ONNX session is shared. Each caller has its own context and recurrent state.
// Use Silero's dual-rate model with input, state, sr, output and stateN tensors.
async function loadSilero(modelPath, ort = require('onnxruntime-node')) {
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
  });
  const rate = new ort.Tensor('int64', BigInt64Array.of(BigInt(sampleRate)), []);
  return () => {
    let state = new ort.Tensor('float32', new Float32Array(256), [2, 1, 128]);
    let context = new Float32Array(contextSamples);
    return async pcm => {
      const input = new Float32Array(contextSamples + frameSamples);
      input.set(context);
      for (let i = 0; i < frameSamples; i++) input[i + contextSamples] = pcm.readInt16LE(i * 2) / 32768;
      const result = await session.run({
        input: new ort.Tensor('float32', input, [1, input.length]),
        state,
        sr: rate,
      });
      state = result.stateN;
      context = input.slice(-contextSamples);
      const probability = result.output.data[0];
      if (!Number.isFinite(probability)) throw Error('Invalid Silero output');
      return probability;
    };
  };
}

function initialAudio(connectedAt, score) {
  const deadline = connectedAt + noCustomerSpeechMs;
  let bytes = 0;
  let lastPacketAt = 0;
  let done = false;
  let speech = false;
  let modelUncertain = !score;
  let speechFrames = 0;
  let uncertainFrames = 0;
  let playbackOverlap = false;
  let maxProbability = 0;
  let running = false;
  let queued = Buffer.alloc(0);

  async function processFrames() {
    running = true;
    try {
      while (!done && !speech && queued.length >= frameSamples * 2) {
        const frame = queued.subarray(0, frameSamples * 2);
        queued = queued.subarray(frameSamples * 2);
        const probability = await score(frame);
        maxProbability = Math.max(maxProbability, probability);
        // A transient can leave elevated probabilities in the model state.
        // Require signal in the current block before counting that probability.
        const hasSignal = speechBlock(frame, probability);
        speechFrames = hasSignal && probability >= 0.20 ? speechFrames + 1 : 0;
        if (hasSignal && probability >= 0.12) uncertainFrames++;
        if (speechFrames >= 2) speech = true;
      }
    } catch {
      modelUncertain = true;
    } finally {
      running = false;
      if (done || speech || modelUncertain) queued = Buffer.alloc(0);
    }
  }

  return {
    get speech() { return speech; },
    receive(pcm, now, overlap = false) {
      if (done || speech) return;
      if (now > deadline + 180) return;
      playbackOverlap ||= overlap;
      lastPacketAt = now;
      bytes += pcm.length;
      if (modelUncertain) return;
      if (queued.length + pcm.length > sampleRate * 2) {
        modelUncertain = true;
        queued = Buffer.alloc(0);
        return;
      }
      queued = Buffer.concat([queued, pcm]);
      if (!running) void processFrames();
    },
    recognize() {
      speech = true;
      queued = Buffer.alloc(0);
    },
    evaluate(now) {
      if (done || now < deadline) return;
      // Let the last inference frame finish; sustained backpressure is uncertainty.
      if (running && now < deadline + 180) return;
      done = true;
      const audioMs = bytes / (sampleRate * 2 / 1000);
      // Packet absence or gaps cannot establish silence. Keep ambiguous signal
      // and any credible speech, including speech below the transcript threshold.
      let result = 'preserve';
      if (!bytes) result = 'missing_pcm';
      else if (!speech && !playbackOverlap && uncertainFrames < 2 && !modelUncertain && !running &&
        audioMs >= noCustomerSpeechMs - 1000 && deadline - lastPacketAt <= 200) result = 'no_speech_timeout';
      queued = Buffer.alloc(0);
      return { result, audioMs, decisionDelayMs: now - deadline, speech, modelUncertain, maxProbability };
    },
    close() {
      done = true;
      queued = Buffer.alloc(0);
    },
  };
}

module.exports = { initialAudio, loadSilero, hasSpeech, noCustomerSpeechMs };
