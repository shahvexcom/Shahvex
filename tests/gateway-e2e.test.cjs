const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { run } = require('../gateway/e2e.cjs');
const { backendClient } = require('../gateway/backend-client.cjs');
const { createServer } = require('../gateway/server.cjs');
const { check } = require('../gateway/isolation-check.cjs');
const token = 'website-backend-fixture-'.repeat(3);
const config = require('../gateway/agent-e2e.example.json');
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s => new Promise(r => { s.closeAllConnections(); s.close(r); });
test('backend E2E runner returns audio, rejects bad authentication and cleans cancelled sessions', async () => {
  let turns = 0;
  const server = createServer({ token, logger: () => {}, services: {
    voices: [{ id: config.voiceId, verified: true }], health: async () => ({ ready: true }),
    stt: async () => 'Hello', llm: async messages => { assert.match(messages[0].content, /Shahvex Test Agent/); turns++; return 'Automated assistant'; },
    tts: async function* () { for (let i = 0; i < 4; i++) { yield Buffer.alloc(640); await new Promise(r => setTimeout(r, 10)); } },
  } });
  const baseUrl = await listen(server); const pcm = Buffer.alloc(6400);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(2000, i);
  try {
    const result = await run({ baseUrl, token, config, pcm }); assert.equal(result.cleanup, true); assert.equal(result.bytes, 2560);
    const cancelled = await run({ baseUrl, token, config, pcm, cancelOnAudio: true }); assert.equal(cancelled.cancelled, true); assert.equal(cancelled.cleanup, true);
    await assert.rejects(run({ baseUrl, token: 'invalid'.repeat(8), config, pcm }), /authentication/);
    assert.equal(turns, 2);
    assert.deepEqual(await check({ baseUrl, token, config }), { passed: true, staleTokenRejected: true, serviceTokenScoped: true, cleanup: true });
  } finally { await close(server); }
});
test('backend absolute deadline terminates a stalled gateway stream', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200); res.flushHeaders(); });
  const baseUrl = await listen(server);
  try {
    const client = backendClient({ baseUrl, token, timeoutMs: 50 });
    const stream = client.stream({ id: 'fixture', sessionToken: 'fixture' }, () => {}); stream.request.end();
    await assert.rejects(stream.done, /deadline|aborted/);
  } finally { await close(server); }
});
