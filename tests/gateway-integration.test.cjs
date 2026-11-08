const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../gateway/server.cjs');
const { createServices, localUrl } = require('../gateway/services.cjs');
const fs = require('node:fs');
const crypto = require('node:crypto');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = { agentName: 'Nadia', campaignId: 'local-fixture', direction: 'inbound', script: 'Describe only the documented service.', voiceId: 'fixture-only' };
const token = 'local-fixture-secret-'.repeat(3);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const speech = Buffer.alloc(640 * 10); for (let i = 0; i < speech.length; i += 2) speech.writeInt16LE(2000, i);
const utterance = Buffer.concat([speech, Buffer.alloc(640 * 20)]);

test('loader evidence hashes match and startup/config contain no loader', async () => {
  const hashes = JSON.parse(fs.readFileSync('backups/security/sha256.json', 'utf8').replace(/^\uFEFF/, ''));
  for (const entry of hashes) {
    const filename = entry.Path.split(/[\\/]/).at(-1);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(`backups/security/${filename}`)).digest('hex').toUpperCase(), entry.Hash);
  }
  assert.doesNotMatch(fs.readFileSync('init', 'utf8'), /eval|spawn|require\(/);
  const config = fs.readFileSync('postcss.config.mjs', 'utf8');
  assert.doesNotMatch(config, /global|require|eval|spawn/);
  assert.match(config, /@tailwindcss\/postcss/);
  assert.doesNotMatch(JSON.stringify(require('../package.json').scripts), /node init/);
});

test('engine clients restrict destinations, redirects and malformed contracts', () => {
  assert.throws(() => localUrl('https://external.example'), /loopback/);
  assert.throws(() => localUrl('http://user:secret@localhost'), /credentials/);
  assert.throws(() => createServices({ tts: { protocol: 'unknown' } }), /contract/);
});

test('local simulated bidirectional PCM with HTTP engines, VAD and playback barge-in', { timeout: 15000 }, async () => {
  const messages = []; let synthesis = 0; const logs = [];
  const engine = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'shahvex-natural:latest' }] }));
    if (req.url === '/health') return res.end('{"ready":true}');
    if (req.url === '/fixture-stt') {
      assert.equal(req.headers['content-type'], 'audio/pcm;rate=16000;channels=1');
      assert.equal(Buffer.concat(chunks).length % 640, 0); return res.end('{"text":"Hello"}');
    }
    if (req.url === '/api/chat') {
      const data = JSON.parse(Buffer.concat(chunks)); assert.equal(data.model, 'shahvex-natural'); messages.push(data.messages);
      return res.end(JSON.stringify({ message: { content: 'I am an automated assistant.' } }));
    }
    if (req.url === '/fixture-tts') {
      synthesis++; assert.equal(JSON.parse(Buffer.concat(chunks)).voice, 'fixture-only');
      res.setHeader('Content-Type', 'audio/pcm');
      for (let i = 0; i < 30 && !res.destroyed; i++) { res.write(speech.subarray(0, 640)); await sleep(10); } return res.end();
    }
    res.writeHead(404); res.end();
  });
  const engineUrl = await listen(engine);
  const services = createServices({ ollamaUrl: engineUrl, stt: { protocol: 'pcm16-json-text', url: `${engineUrl}/fixture-stt`, healthUrl: `${engineUrl}/health` }, tts: { protocol: 'json-pcm16', url: `${engineUrl}/fixture-tts`, healthUrl: `${engineUrl}/health`, sampleRate: 16000 }, voices: [{ id: 'fixture-only', verified: true }] });
  const server = createServer({ token, services, maxSessions: 2, logger: event => logs.push(event) });
  const url = await listen(server);
  try {
    assert.equal((await fetch(`${url}/health`)).status, 401);
    assert.equal((await (await fetch(`${url}/health`, { headers })).json()).ready, true);
    const a = await (await fetch(`${url}/sessions`, { method: 'POST', headers, body: JSON.stringify(config) })).json();
    const b = await (await fetch(`${url}/sessions`, { method: 'POST', headers, body: JSON.stringify({ ...config, agentName: 'Sara', campaignId: 'second' }) })).json();
    const capacity = await fetch(`${url}/sessions`, { method: 'POST', headers, body: JSON.stringify(config) }); assert.equal(capacity.status, 429);
    assert.equal((await fetch(`${url}/sessions/${a.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${b.sessionToken}` } })).status, 401);
    assert.equal((await fetch(`${url}/sessions/${a.id}`, { method: 'DELETE', headers })).status, 403);
    const events = await new Promise((resolve, reject) => {
      const events = []; let carry = ''; let interrupted = false;
      const request = http.request(`${url}/sessions/${a.id}/stream`, { method: 'POST', headers: { Authorization: `Bearer ${a.sessionToken}`, 'Content-Type': 'audio/pcm;rate=16000;channels=1' } }, response => {
        assert.equal(response.statusCode, 200);
        response.on('data', chunk => {
          carry += chunk.toString(); let index;
          while ((index = carry.indexOf('\n')) >= 0) {
            const event = JSON.parse(carry.slice(0, index)); carry = carry.slice(index + 1); events.push(event);
            if (event.type === 'audio' && !interrupted) { interrupted = true; request.write(utterance); }
            if (event.type === 'turn-end') request.end();
          }
        });
        response.on('end', () => resolve(events)); response.on('error', reject);
      });
      request.on('error', reject); request.setTimeout(8000, () => request.destroy(Error('Simulation timed out'))); request.write(utterance);
    });
    const clears = events.filter(e => e.type === 'clear'); assert.equal(clears.length, 2);
    assert.ok(events.some(e => e.type === 'cancelled'));
    const cutoff = events.findIndex(e => e.type === 'clear' && e.generation === clears[1].generation);
    assert.ok(events.slice(cutoff).filter(e => e.type === 'audio').every(e => e.generation > clears[1].generation));
    assert.equal(events.filter(e => e.type === 'turn-end').length, 1); assert.equal(synthesis, 2);
    assert.equal(messages.length, 2); assert.match(messages[0][0].content, /Nadia/); assert.match(messages[0][0].content, /local-fixture/);
    assert.equal(messages[1].length, 2, 'cancelled reply is absent from conversation history');
    for (const stage of ['stt', 'llm', 'tts', 'queue']) assert.ok(logs.some(e => e.stage === stage));
    assert.ok(!JSON.stringify(logs).includes(a.sessionToken));
    assert.equal((await fetch(`${url}/sessions/${a.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${a.sessionToken}` } })).status, 200);
  } finally { await close(server); await close(engine); }
});

test('health does not claim readiness for absent engine services', async () => {
  const services = createServices({}, async () => { throw Error('offline'); });
  const health = await services.health(); assert.equal(health.ready, false); assert.equal(health.services.ollama.ready, false);
});
