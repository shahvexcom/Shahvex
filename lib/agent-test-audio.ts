export function inspectSpeechWav(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw Error("Expected a PCM WAV recording");
  let start = 0, length = 0, valid = false;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true), next = at + 8 + size;
    if (next > bytes.length) throw Error("Incomplete WAV recording");
    if (tag(at) === "fmt " && size >= 16) valid = view.getUint16(at + 8, true) === 1 && view.getUint16(at + 10, true) === 1 && view.getUint32(at + 12, true) === 16000 && view.getUint16(at + 22, true) === 16;
    if (tag(at) === "data") { start = at + 8; length = size; }
    at = next + size % 2;
  }
  if (!valid || !start || !length || length % 2) throw Error("Recording must be 16 kHz mono PCM16");
  let voicedFrames = 0, sum = 0, frames = 0;
  for (let at = start; at + 640 <= start + length; at += 640) {
    let power = 0; for (let i = 0; i < 320; i++) { const x = view.getInt16(at + i * 2, true); power += x * x; }
    sum += power; frames++; if (Math.sqrt(power / 320) >= 350) voicedFrames++;
  }
  const durationMs = length / 32, voicedMs = voicedFrames * 20, rms = Math.sqrt(sum / Math.max(1, frames * 320));
  return { durationMs, voicedMs, rms: Math.round(rms), speech: durationMs <= 21000 && voicedMs >= 180 && voicedFrames / Math.max(1, frames) >= .06 && rms >= 140 };
}
export function speechWav(frames: Int16Array[]) {
  const size = frames.reduce((n, f) => n + f.length * 2, 0), buffer = new ArrayBuffer(44 + size), view = new DataView(buffer);
  const tag = (at: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  tag(0, "RIFF"); view.setUint32(4, 36 + size, true); tag(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, size, true);
  let at = 44; for (const frame of frames) for (const sample of frame) { view.setInt16(at, sample, true); at += 2; }
  return new Blob([buffer], { type: "audio/wav" });
}
