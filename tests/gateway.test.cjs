const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Gateway, WorkerQueue, pcm16 } = require('../gateway/core.cjs');
const { spawn } = require('node:child_process');
const net = require('node:net');
const config = { script: 'Explain the service accurately.', campaignId: 'test', direction: 'outbound', voiceId: 'fixture', transferDestinations: ['support'] };
function gateway(extra = {}) {
  return new Gateway({ stt: async () => 'Hello', llm: async () => 'I am an automated assistant.', tts: async () => Buffer.alloc(320), telephony: { transfer: async () => {} }, voices: [{ id: 'fixture', verified: true }], ...extra });
}
test('configuration rejects unverified voices and missing regulated consent', () => {
  const g = gateway();
  assert.throws(() => g.create('a', { ...config, voiceId: 'male' }), /verified/);
  assert.throws(() => g.create('a', { ...config, regulated: true }), /consent/);
  g.create('a', config); assert.throws(() => g.create('b', config), /capacity/);
});
test('sessions enforce ownership, keep isolated histories and clean up', async () => {
  const g = gateway({ maxSessions: 2 }); const a = g.create('a', config), b = g.create('b', config);
  assert.throws(() => g.close('b', a), /unavailable/);
  await assert.rejects(g.turn('b', a, Buffer.alloc(320)), /unavailable/);
  const result = await g.turn('a', a, Buffer.alloc(320)); assert.equal(result.text, 'Hello');
  assert.equal(g.sessions.get(a).history.length, 2); assert.equal(g.sessions.get(b).history.length, 0);
  g.close('a', a); assert.equal(g.sessions.size, 1);
});
test('interruption discards late inference output', async () => {
  let release; let entered;
  const started = new Promise(r => { entered = r; });
  const g = gateway({ llm: () => { entered(); return new Promise(r => { release = r; }); } });
  const id = g.create('a', config); const turn = g.turn('a', id, Buffer.alloc(320));
  await started; g.interrupt('a', id); release('late');
  await assert.rejects(turn, /Cancelled/); assert.equal(g.sessions.get(id).history.length, 0);
});
test('transfers enforce destinations and require trusted completed qualification', async () => {
  const calls = []; const g = gateway({ telephony: { transfer: async (...args) => calls.push(args) } });
  const id = g.create('a', config);
  await assert.rejects(g.transfer('a', id, 'premium'), /forbidden/);
  await assert.rejects(g.transfer('a', id, 'support'), /qualification/);assert.deepEqual(calls, []);
  const session=g.sessions.get(id);
  session.intelligenceSnapshot={policy:{questions:{age:'What is your age?',state:'Which state?'}}};
  session.intelligenceState={answers:{age:'65'}};
  await assert.rejects(g.transfer('a', id, 'support'), /qualification/);
  session.intelligenceState.answers.state='Kentucky';
  await g.transfer('a', id, 'support'); assert.deepEqual(calls, [[id, 'support']]);
});
test('queue bounds pending work and removes cancelled jobs', async () => {
  const q = new WorkerQueue(1, 1); let release;
  const active = q.run(() => new Promise(r => { release = r; }), new AbortController().signal);
  await Promise.resolve(); const cancel = new AbortController();
  const pending = q.run(async () => 'never', cancel.signal);
  await assert.rejects(q.run(async () => {}, new AbortController().signal), /full/);
  cancel.abort(); await assert.rejects(pending, /Cancelled/); assert.equal(q.pending.length, 0);
  release(); await active;
});
test('simulated PCM chunks convert and reject malformed formats', () => {
  const input = Buffer.alloc(640); input.writeInt16LE(1000, 0); input.writeInt16LE(3000, 2);
  const down = pcm16(input, 16000, 8000); assert.equal(down.length, 320); assert.equal(down.readInt16LE(), 2000);
  assert.equal(pcm16(down, 8000, 16000).length, 640);
  assert.throws(() => pcm16(Buffer.alloc(3), 8000, 16000), /format/);
  assert.throws(() => pcm16(input, 44100, 16000), /format/);
});
test('standalone health requires authentication and reports integration unready', async () => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const token = 'fixture-secret-'.repeat(4);
  const child = spawn(process.execPath, ['gateway/server.cjs'], { env: { ...process.env, SHAHVEX_GATEWAY_TOKEN: token, SHAHVEX_GATEWAY_PORT: String(port) }, stdio: 'ignore' });
  try {
    let response;
    for (let i = 0; i < 50; i++) {
      try { response = await fetch(`http://127.0.0.1:${port}/health`); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    assert.equal(response?.status, 401);
    const health = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(health.status, 200); assert.equal((await health.json()).ready, false);
  } finally { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
});
