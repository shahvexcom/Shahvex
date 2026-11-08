/** Records the live mixed Web Audio destination. No audio is uploaded. */
export class ConversationRecorder {
  private recorder?: MediaRecorder;
  private parts: Blob[] = [];
  private bytes = 0;
  private discarded = false;
  private failed = false;
  private mime = '';
  start(stream: MediaStream, done: (blob: Blob) => void, fail: (message: string) => void) {
    if (this.recorder) throw Error('Recording already started');
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw Error('This browser has no supported audio recording format');
    this.mime = mime;
    this.recorder = new MediaRecorder(stream, { mimeType: mime });
    this.recorder.ondataavailable = event => {
      if (this.discarded || this.failed || !event.data.size) return;
      this.bytes += event.data.size;
      if (this.bytes > 20000000) { this.failed = true; this.parts = []; this.stop(); fail('Recording exceeded 20MB; export cancelled'); return; }
      this.parts.push(event.data);
    };
    this.recorder.onerror = () => { this.failed = true; this.parts = []; this.stop(); fail('Browser recording failed'); };
    this.recorder.onstop = () => {
      const blob = new Blob(this.parts, { type: this.mime }); this.parts = [];
      if (this.discarded || this.failed) return;
      if (!blob.size) { fail('No recorded audio was captured'); return; }
      done(blob);
    };
    this.recorder.start(250);
  }
  stop() { if (this.recorder?.state !== 'inactive') this.recorder?.stop(); }
  discard() { this.discarded = true; this.stop(); this.parts = []; }
}
