const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServices } = require('../gateway/services.cjs');
const { decodeWav, resample } = require('../gateway/wav.cjs');
const { backendClient } = require('../gateway/backend-client.cjs');
const { createServer } = require('../gateway/server.cjs');
function wav() {
  const b = Buffer.alloc(44 + 4800); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(4800, 40); return b;
}
test('physical contract parses streaming Ollama and native Chatterbox WAV without changing its request', async () => {
  const calls = [];
  const services = createServices({ ollamaStreaming: true, tts: { protocol: 'chatterbox-wav', url: 'http://127.0.0.1:8765/synthesize' } }, async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).includes('11434')) return new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.from('{"message":{"content":"Hel')); c.enqueue(Buffer.from('lo"},"done":false}\n{"message":{"content":" there"},"done":true}\n')); c.close(); } }));
    return new Response(wav());
  });
  const signal = new AbortController().signal;
  assert.equal(await services.llm([{ role: 'user', content: 'hello' }], signal), 'Hello there');
  assert.equal(calls[0].body.stream, true); assert.equal(calls[0].body.model, 'shahvex-natural');
  const chunks = []; for await (const chunk of services.tts('Hello', 'existing-default', signal)) chunks.push(chunk);
  assert.deepEqual(calls[1].body, { text: 'Hello' }); assert.equal(Buffer.concat(chunks).length, 3200);
  assert.equal(decodeWav(wav()).sampleRate, 24000);
  assert.throws(() => decodeWav(wav().subarray(0, 50)), /Truncated/);
  assert.equal(resample(Buffer.alloc(160), 8000, 16000).length, 320);
});
test('trusted backend client creates, streams and closes scoped call through loopback bridge', async () => {
  const token = 'physical-bridge-fixture-'.repeat(3);
  const server = createServer({ token, logger: () => {}, services: { voices: [{ id: 'fixture', verified: true }], stt: async () => 'Hello', llm: async () => 'Reply', tts: async () => Buffer.alloc(640), health: async () => ({ ready: true }) } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const client = backendClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token });
    const session = await client.create({ agentName: 'Nadia', script: 'Explain accurately', campaignId: 'test', direction: 'inbound', voiceId: 'fixture' });
    const events = []; const { request, done } = client.stream(session, event => events.push(event));
    const speech = Buffer.alloc(640); for (let i = 0; i < 640; i += 2) speech.writeInt16LE(2000, i);
    request.write(Buffer.concat(Array(10).fill(speech))); request.end(Buffer.alloc(6400)); await done;
    assert.ok(events.some(e => e.type === 'audio')); assert.ok(events.some(e => e.type === 'turn-end'));
    await client.close(session);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
