/** Counts only continuous listening time, never synthesis, playback or muted time. */
export class ConversationSilence {
  private quietSince: number | undefined;
  private checks = 0;
  reset() { this.quietSince = undefined; this.checks = 0; }
  speech() { this.reset(); }
  tick(now: number, blocked: boolean): 1 | 2 | 3 | 4 | undefined {
    if (blocked) { this.quietSince = undefined; return; }
    if (this.quietSince === undefined) { this.quietSince = now; return; }
    if (now - this.quietSince < 10000 || this.checks >= 4) return;
    this.quietSince = undefined;
    return ++this.checks as 1 | 2 | 3 | 4;
  }
}
