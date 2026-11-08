class ShahvexMicrophone extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Int16Array(320); this.offset = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.frame[this.offset++] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
      if (this.offset === 320) { this.port.postMessage(this.frame.buffer, [this.frame.buffer]); this.frame = new Int16Array(320); this.offset = 0; }
    }
    return true;
  }
}
registerProcessor('shahvex-microphone', ShahvexMicrophone);
