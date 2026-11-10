/** Convert the complete local recording into a real mono PCM WAV, not a renamed container. */
export async function recordingWav(blob: Blob): Promise<Blob> {
  const decoder = new OfflineAudioContext(1, 1, 16000);
  const audio = await decoder.decodeAudioData(await blob.arrayBuffer());
  const size = audio.length * 2;
  if (!audio.length || size > 64000000) throw Error('Recording is too large for WAV export');
  const bytes = new ArrayBuffer(44 + size), view = new DataView(bytes);
  const label = (at: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  label(0, 'RIFF'); view.setUint32(4, 36 + size, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, size, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  for (let i = 0; i < audio.length; i++) {
    let value = 0; for (const channel of channels) value += channel[i];
    value = Math.max(-1, Math.min(1, value / channels.length));
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
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
    this.recorder.onstop = async () => {
      const blob = new Blob(this.parts, { type: this.mime }); this.parts = [];
      if (this.discarded || this.failed) return;
      if (!blob.size) { fail('No recorded audio was captured'); return; }
      try {
        const wav = await recordingWav(blob);
        if (!this.discarded) done(wav);
      } catch { if (!this.discarded) fail('Unable to prepare the WAV audio download'); }
    };
    this.recorder.start(250);
  }
  stop() { if (this.recorder?.state !== 'inactive') this.recorder?.stop(); }
  discard() { this.discarded = true; this.stop(); this.parts = []; }
}
