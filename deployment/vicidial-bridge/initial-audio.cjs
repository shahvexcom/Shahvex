'use strict';

const sampleRate = 8000;
const frameSamples = 256;
const contextSamples = 32;
const decisionMs = 10000;

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
  const deadline = connectedAt + decisionMs;
  let bytes = 0;
  let lastPacketAt = 0;
  let done = false;
  let speech = false;
  let modelUncertain = !score;
  let speechFrames = 0;
  let uncertainFrames = 0;
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
        let signalSamples = 0;
        for (let i = 0; i < frame.length; i += 2) {
          if (frame.readInt16LE(i) !== 0) signalSamples++;
        }
        const hasSignal = signalSamples >= 16;
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
    receive(pcm, now) {
      if (done || speech) return;
      if (now > deadline + 180) return;
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
      else if (!speech && uncertainFrames < 2 && !modelUncertain && !running &&
        audioMs >= 9000 && deadline - lastPacketAt <= 200) result = 'no_speech_timeout';
      queued = Buffer.alloc(0);
      return { result, audioMs, decisionDelayMs: now - deadline, speech, modelUncertain, maxProbability };
    },
    close() {
      done = true;
      queued = Buffer.alloc(0);
    },
  };
}

module.exports = { initialAudio, loadSilero };
