'use strict';
function decodeWav(wav) {
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw Error('Invalid WAV');
  let format; let audio;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const tag = wav.toString('ascii', offset, offset + 4), size = wav.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > wav.length) throw Error('Truncated WAV');
    if (tag === 'fmt ') {
      if (size < 16) throw Error('Invalid WAV format');
      format = { encoding: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), rate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14) };
    }
    if (tag === 'data') audio = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || !audio || format.encoding !== 1 || format.channels !== 1 || format.bits !== 16 || format.rate < 8000 || format.rate > 96000 || audio.length % 2) throw Error('Expected mono PCM16 WAV');
  return { audio, sampleRate: format.rate };
}
function resample(audio, from, to) {
  if (audio.length % 2 || !Number.isInteger(from) || !Number.isInteger(to) || from < 8000 || from > 96000 || to < 8000 || to > 96000) throw Error('Unsupported PCM rate');
  const count = audio.length / 2; const output = Buffer.alloc(Math.floor(count * to / from) * 2);
  for (let i = 0; i < output.length / 2; i++) {
    const position = i * from / to, left = Math.floor(position), fraction = position - left;
    output.writeInt16LE(Math.round(audio.readInt16LE(left * 2) * (1 - fraction) + audio.readInt16LE(Math.min(left + 1, count - 1) * 2) * fraction), i * 2);
  }
  return output;
}
module.exports = { decodeWav, resample };
