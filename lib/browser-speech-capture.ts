import { speechWav } from "./agent-test-audio";
/** One finalized recording per speech segment, with short-noise and playback-echo rejection. */
export class BrowserSpeechCapture {
  constructor(private readonly speculative = false) {}
  private frames: Int16Array[] = [];
  private pre: Int16Array[] = [];
  private voiced = 0;
  private quiet = 0;
  private talking = false;
  private lastSpeechAtMs = 0;
  private draftSent = false;
  private reference: number[] = [];
  private referenceAt = 0;
  reset() { this.frames = []; this.pre = []; this.voiced = 0; this.quiet = 0; this.talking = false; this.lastSpeechAtMs = 0; this.draftSent = false; }
  playback(samples: Float32Array) { this.reference.push(...samples); if (this.reference.length > 12000) this.reference.splice(0, this.reference.length - 12000); this.referenceAt = performance.now(); }
  private echo(frame: Int16Array) {
    if (performance.now() - this.referenceAt > 450 || this.reference.length < frame.length) return false;
    let energy = 0; for (let i = 0; i < frame.length; i += 4) energy += (frame[i] / 32768) ** 2;
    if (energy < .000001) return false;
    // Compare recent actual output at several acoustic delays. Independent near-end
    // speech can still trigger barge-in when it does not match our playback.
    for (let at = Math.max(0, this.reference.length - 6500); at <= this.reference.length - frame.length; at += 32) {
      let dot = 0, refEnergy = 0;
      for (let i = 0; i < frame.length; i += 4) { const r = this.reference[at + i]; dot += frame[i] / 32768 * r; refEnergy += r * r; }
      if (refEnergy > .000001 && Math.abs(dot) / Math.sqrt(energy * refEnergy) > .72) return true;
    }
    return false;
  }
  feed(frame: Int16Array, playbackActive: boolean) {
    let power = 0; for (const x of frame) power += x * x;
    const rms = Math.sqrt(power / frame.length), echo = this.echo(frame), speech = !echo && rms > (playbackActive ? 1000 : 500);
    const draftInvalidated = speech && this.draftSent;
    if (speech) this.draftSent = false;
    if (speech) { this.voiced++; this.quiet = 0; this.lastSpeechAtMs = performance.now(); } else this.quiet++;
    let started = false;
    if (!this.talking && speech && this.voiced >= (playbackActive ? 8 : 5)) { this.talking = true; this.frames = [...this.pre]; started = true; }
    if (!this.talking && !speech) this.voiced = 0;
    if (this.talking) this.frames.push(echo ? new Int16Array(frame.length) : frame);
    this.pre.push(echo ? new Int16Array(frame.length) : frame); if (this.pre.length > 8) this.pre.shift();
    let recording: { blob: Blob; durationMs: number; voicedMs: number; id: string; speechEndedAtMs: number } | undefined;
    let draft: { blob: Blob; id: string; speechEndedAtMs: number } | undefined;
    // Local speculative prototype only. Keep recording and the original 500 ms
    // finalization guard; a draft must never be played or committed on its own.
    if (this.speculative && this.talking && this.quiet >= 5 && this.voiced >= 10 && !this.draftSent) {
      draft = { blob: speechWav(this.frames), id: crypto.randomUUID(), speechEndedAtMs: this.lastSpeechAtMs };
      this.draftSent = true;
    }
    // 500 ms of trailing silence; retain the existing speech/echo safeguards.
    if (this.talking && (this.quiet >= 25 || this.frames.length >= 1000)) {
      if (this.voiced >= 10) recording = { blob: speechWav(this.frames), durationMs: this.frames.length * 20, voicedMs: this.voiced * 20, id: crypto.randomUUID(), speechEndedAtMs: this.lastSpeechAtMs };
      this.reset();
    }
    return { started, recording, draft, draftInvalidated, rms, echo };
  }
}
