"use client";

type State = "connecting" | "listening" | "stopped" | "error";
/** Receive-only PCM player. No microphone, media capture, or audio upload path. */
export class LiveCallListener {
  private controller?: AbortController;
  private context?: AudioContext;
  private notify?: (state: State, message?: string) => void;
  stop(notify = true) {
    this.controller?.abort(); this.controller = undefined;
    const context = this.context; this.context = undefined;
    if (context && context.state !== "closed") void context.close().catch(() => {});
    if (notify) this.notify?.("stopped"); this.notify = undefined;
  }
  async start(url: string, notify: (state: State, message?: string) => void) {
    this.stop();
    const controller = new AbortController(); this.controller = controller; this.notify = notify;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const context = new AudioContext(); this.context = context;
      notify("connecting"); await context.resume();
      if (controller.signal.aborted) return;
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.message || "Live listening could not connect."); }
      if (!response.body || !response.headers.get("content-type")?.startsWith("application/octet-stream")) throw Error("Invalid live audio stream.");
      reader = response.body.getReader(); let carry = new Uint8Array(0), next = context.currentTime + 0.08, announced = false;
      while (!controller.signal.aborted) {
        const {done, value} = await reader.read(); if (done) break;
        if (context.state !== "running") throw Error("Audio playback paused. Press Listen live again.");
        const bytes = new Uint8Array(carry.length + value.length); bytes.set(carry); bytes.set(value, carry.length);
        // Schedule 40–80 ms blocks; discard stale buffered audio instead of building delay.
        const usable = Math.floor(bytes.length / 1280) * 1280;
        if (!usable) { carry = bytes; continue; }
        const start = Math.max(0, usable - 8000); // At most 250 ms from a delayed network chunk.
        const aligned = Math.ceil(start / 4) * 4, frames = (usable - aligned) / 4;
        if (next > context.currentTime + 0.35) { carry = bytes.slice(usable); continue; }
        const buffer = context.createBuffer(1, frames, 8000), channel = buffer.getChannelData(0), view = new DataView(bytes.buffer, bytes.byteOffset + aligned, frames * 4);
        for (let i = 0; i < frames; i++) channel[i] = (view.getInt16(i * 4, true) + view.getInt16(i * 4 + 2, true)) / 65536;
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
        next = Math.max(next, context.currentTime + 0.03); source.start(next); next += buffer.duration;
        source.onended = () => source.disconnect(); carry = bytes.slice(usable);
        if (!announced) { announced = true; notify("listening"); }
      }
      if (!controller.signal.aborted && this.controller === controller) { this.stop(false); notify("stopped", "Live audio ended. The call may have ended or moved to a human agent."); }
    } catch (error) {
      if (!controller.signal.aborted && this.controller === controller) { this.stop(false); notify("error", error instanceof Error ? error.message : "Live audio disconnected."); }
    } finally {
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  }
}
