/* Mono PCM16 playback. Fixed four-second ring, linear 24k -> device-rate resampling. */
class ShahvexPlayback extends AudioWorkletProcessor {
  constructor() {
    super(); this.ring = new Float32Array(24000 * 4); this.read = 0; this.count = 0;
    this.epoch = 0; this.playing = false; this.ending = false; this.clock = 0; this.underruns = 0; this.audible = false; this.reference = new Float32Array(320); this.referenceOffset = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "clear") { this.epoch = data.epoch; this.read = 0; this.count = 0; this.playing = false; this.audible = false; this.ending = false; this.referenceOffset = 0; this.port.postMessage({ type: "cleared", epoch: this.epoch }); return; }
      if (data.epoch !== this.epoch) return;
      if (data.type === "end") { this.ending = true; return; }
      if (data.type !== "pcm") return;
      const pcm = new Int16Array(data.pcm);
      if (pcm.length > this.ring.length - Math.ceil(this.count)) { this.port.postMessage({ type: "overflow", epoch: this.epoch }); return; }
      let write = Math.round(this.read + this.count) % this.ring.length;
      for (const sample of pcm) { this.ring[write] = sample / 32768; write = (write + 1) % this.ring.length; }
      this.count += pcm.length; this.ending = false;
    };
  }
  process(inputs, outputs) {
    const output = outputs[0]?.[0]; if (!output) return true;
    output.fill(0); let exhausted = false; const step = 24000 / sampleRate;
    if (!this.playing && (this.count >= 24000 * .06 || (this.ending && this.count > 0))) {
      this.playing = true;
    }
    if (this.playing) for (let i = 0; i < output.length; i++) {
      if (this.count < step) {
        this.count = 0; this.read = 0; this.playing = false; exhausted = true;
        if (!this.ending) this.underruns++;
        break;
      }
      const at = Math.floor(this.read), fraction = this.read - at;
      output[i] = this.ring[at] * (1 - fraction) + (this.count > 1 ? this.ring[(at + 1) % this.ring.length] : 0) * fraction;
      this.read = (this.read + step) % this.ring.length; this.count -= step;
    }
    let energy = 0; for (const x of output) energy += x * x;
    if (energy > 0.000001 && !this.audible) { this.audible = true; this.port.postMessage({ type: "started", epoch: this.epoch, contextTime: currentTime }); }
    if (sampleRate === 16000 && energy > 0.000001) for (const x of output) {
      this.reference[this.referenceOffset++] = x;
      if (this.referenceOffset === 320) { this.port.postMessage({ type: "reference", epoch: this.epoch, samples: this.reference.buffer }, [this.reference.buffer]); this.reference = new Float32Array(320); this.referenceOffset = 0; }
    }
    if (exhausted) { this.audible = false; this.port.postMessage({ type: "idle", epoch: this.epoch, underruns: this.underruns }); }
    this.clock += output.length;
    if (this.clock >= sampleRate / 20) { this.clock = 0; this.port.postMessage({ type: "buffer", epoch: this.epoch, queuedMs: this.count / 24 }); }
    return true;
  }
}
registerProcessor("shahvex-playback", ShahvexPlayback);
