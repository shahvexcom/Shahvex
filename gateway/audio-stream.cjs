'use strict';
const { randomUUID } = require('node:crypto');
// Local simulation transport: 20ms, 16kHz, mono signed little-endian PCM frames.
// This energy VAD is deliberately separate from the existing engine's barge-in.
class AudioStream {
  constructor(gateway, owner, id, emit, { threshold = 500, silenceFrames = 20, maxFrames = 500, onsetFrames = 8 } = {}) {
    if (!Number.isInteger(silenceFrames) || silenceFrames < 15 || silenceFrames > 50) throw Error('Endpoint silence must be 300–1000ms');
    if (!Number.isInteger(onsetFrames) || onsetFrames < 6 || onsetFrames > 15) throw Error('Speech confirmation must be 120–300ms');
    Object.assign(this, { gateway, owner, id, emit, threshold, silenceFrames, maxFrames, onsetFrames });
    this.onset = [];
    this.carry = Buffer.alloc(0); this.frames = []; this.silence = 0; this.speaking = false; this.pending = new Set(); this.closed = false;
    this.frameIndex = 0; this.lastVoicedFrame = 0; this.turnId = '';
  }
  async push(chunk) {
    if (this.closed) throw Error('Stream closed');
    this.carry = Buffer.concat([this.carry, chunk]);
    while (this.carry.length >= 640) {
      const frame = Buffer.from(this.carry.subarray(0, 640)); this.carry = this.carry.subarray(640);
      this.frameIndex++;
      let energy = 0; for (let i = 0; i < 640; i += 2) energy += frame.readInt16LE(i) ** 2;
      const speech = Math.sqrt(energy / 320) >= this.threshold;
      if (!this.speaking) {
        if (!speech) { this.onset = []; continue; }
        this.onset.push(frame);
        if (this.onset.length < this.onsetFrames) continue;
      }
      if (speech && !this.speaking) {
        this.turnId = randomUUID();
        this.gateway.log({ sessionId: this.id, turnId: this.turnId, stage: 'speech-detected', inputOffsetMs: this.frameIndex * 20, at: new Date().toISOString() });
        this.gateway.interrupt(this.owner, this.id); this.speaking = true; this.frames = this.onset.slice(0, -1); this.onset = [];
        await this.emit({ type: 'clear', generation: this.gateway.owned(this.owner, this.id).generation });
        await this.emit({ type: 'speech-start', turnId: this.turnId, inputOffsetMs: this.frameIndex * 20 });
      }
      if (this.speaking) {
        if (speech) this.lastVoicedFrame = this.frameIndex;
        this.frames.push(frame); this.silence = speech ? 0 : this.silence + 1;
        if (this.frames.length >= this.maxFrames) throw Error('Utterance audio limit exceeded');
        if (this.silence >= this.silenceFrames) this.flush();
      }
    }
  }
  flush() {
    if (!this.frames.length) return;
    if (this.pending.size >= 4) throw Error('Too many unfinished turns');
    const audio = Buffer.concat(this.frames); this.frames = []; this.speaking = false; this.silence = 0;
    const turnId = this.turnId;
    const endpoint = { turnId, vadDelayMs: (this.frameIndex - this.lastVoicedFrame) * 20, lastSpeechOffsetMs: this.lastVoicedFrame * 20, inputOffsetMs: this.frameIndex * 20 };
    this.gateway.log({ sessionId: this.id, stage: 'speech-end', ...endpoint, audioMs: audio.length / 32, at: new Date().toISOString() });
    if (!this.closed) void this.emit({ type: 'speech-end', ...endpoint }).catch(() => {});
    let task;
    task = this.gateway.turn(this.owner, this.id, audio, 16000, async (chunk, generation, signal) => {
      await this.emit({ type: 'audio', generation, sampleRate: 16000, pcm: chunk.toString('base64') }, signal);
    }, event => {
      if (!this.closed) void this.emit(event).catch(() => {});
    }, turnId).then(async result => {
      if (!this.closed && this.gateway.owned(this.owner, this.id).generation === result.generation)
        await this.emit({ type: 'turn-end', generation: result.generation });
    })
      .catch(async error => {
        if (!this.closed) {
          const cancelled = error.message === 'Cancelled' || error.name === 'AbortError';
          await this.emit({ type: cancelled ? 'cancelled' : 'turn-error', ...(cancelled ? {} : { stage: error.engineStage || 'transport', turnId: error.turnId, httpStatus: error.httpStatus, code: error.httpStatus === 429 ? 'engine-busy' : error.name === 'TimeoutError' ? 'engine-timeout' : 'engine-failure' }) });
        }
      }).catch(() => {}).finally(() => this.pending.delete(task));
    this.pending.add(task);
  }
  async end() {
    if (this.carry.length) throw Error('Incomplete 20ms PCM frame');
    this.flush(); await Promise.all(this.pending);
  }
  close() { if (this.closed) return; this.closed = true; this.onset = []; this.frames = []; this.carry = Buffer.alloc(0); this.gateway.interrupt(this.owner, this.id); }
}
module.exports = { AudioStream };
