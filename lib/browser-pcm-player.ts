export class BrowserPCMPlayer {
  private node: AudioWorkletNode;
  private epoch = 0;
  private queuedMs = 0;
  private playing = false;
  private watchdog?: ReturnType<typeof setTimeout>;
  constructor(private context: AudioContext, private onEvent: (event: { type: string; contextTime?: number; underruns?: number; samples?: ArrayBuffer }) => void) {
    this.node = new AudioWorkletNode(context, "shahvex-playback", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.node.connect(context.destination);
    this.node.port.onmessage = ({ data }) => {
      if (data.epoch !== this.epoch) return;
      if (data.type === "buffer") { this.queuedMs = data.queuedMs; return; }
      if (data.type === "started") { this.playing = true; clearTimeout(this.watchdog); this.watchdog = undefined; }
      if (data.type === "idle") { this.playing = false; this.queuedMs = 0; }
      onEvent(data);
    };
    this.node.onprocessorerror = () => onEvent({ type: "playback-error" });
  }
  get hasAudio() { return this.playing || this.queuedMs > 0; }
  get isPlaying() { return this.playing; }
  connectRecording(destination: AudioNode) { this.node.connect(destination); }
  clear(epoch: number) { clearTimeout(this.watchdog); this.watchdog = undefined; this.epoch = epoch; this.queuedMs = 0; this.playing = false; this.node.port.postMessage({ type: "clear", epoch }); }
  async push(base64: string, epoch: number, signal: AbortSignal) {
    if (this.context.state === "suspended") await this.context.resume();
    if (this.context.state !== "running") throw Error("Audio output is paused. Click Resume audio or restart testing.");
    while (this.queuedMs > 1000) {
      signal.throwIfAborted(); if (epoch !== this.epoch) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    signal.throwIfAborted(); if (epoch !== this.epoch) return;
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (!bytes.length || bytes.length % 2 || bytes.length > 4800) throw Error("Empty or invalid PCM frame");
    const view = new DataView(bytes.buffer), pcm = new Int16Array(bytes.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true);
    this.queuedMs += pcm.length / 24;
    this.node.port.postMessage({ type: "pcm", epoch, pcm: pcm.buffer }, [pcm.buffer]);
    if (!this.playing && !this.watchdog) this.watchdog = setTimeout(() => { this.watchdog = undefined; if (epoch === this.epoch && this.hasAudio && !this.playing) this.onEvent({ type: "playback-error" }); }, 3000);
  }
  end(epoch: number) { if (epoch === this.epoch) this.node.port.postMessage({ type: "end", epoch }); }
  dispose() { clearTimeout(this.watchdog); this.node.disconnect(); this.node.port.close(); }
}
