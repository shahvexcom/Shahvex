const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const net = require('node:net');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createBridge, packet, signature } = require('../deployment/vicidial-bridge/server.cjs');

test('sequential and 2/5/10 AudioSockets isolate calls registered in either order', { timeout: 20000 }, async () => {
  const secret = 'loopback-fixture-secret-at-least-32-characters';
  const connectionId = randomUUID();
  const folder = mkdtempSync(join(tmpdir(), 'shahvex-link-'));
  const sessions = new Map();
  const sockets = new Set();
  const ended = new Set();
  let sequence = 0;
  let failedId;
  const bridge = createBridge({
    siteUrl: 'https://fixture.invalid/', connectionId, secret, spoolDir: folder, maxCalls: 10,
    logger: () => {},
    fetchImpl: async (_, init) => {
      const event = JSON.parse(init.body);
      if (event.action === 'connected') {
        if (event.externalCallId === failedId) return Response.json({ error: 'Unavailable' }, { status: 409 });
        assert.ok(!sessions.has(event.externalCallId));
        const session = { id: randomUUID(), sample: Number(event.externalCallId.slice(-4)) + 2000 };
        sessions.set(event.externalCallId, session);
        return Response.json({ callId: session.id, first: 'ai', mediaReady: true });
      }
      const session = sessions.get(event.externalCallId);
      assert.equal(event.callId, session.id);
      if (event.action === 'ended') ended.add(session.id);
      if (event.action !== 'turn') return Response.json({ saved: true });
      const pcm = Buffer.alloc(19200);
      for (let offset = 0; offset < pcm.length; offset += 2) pcm.writeInt16LE(session.sample, offset);
      return new Response(JSON.stringify({ type: 'pcm', sampleRate: 24000, data: pcm.toString('base64') }) + '\n');
    },
  });

  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const control = (path, value) => {
    const body = Buffer.from(JSON.stringify(value));
    const stamp = String(Date.now());
    return fetch('http://127.0.0.1:' + bridge.control.address().port + path, {
      method: 'POST', body, headers: {
        'x-shahvex-timestamp': stamp, 'x-shahvex-signature': signature(secret, stamp, 'POST', path, body),
      },
    });
  };
  async function open(uuid) {
    const socket = net.connect(bridge.audio.address().port, '127.0.0.1');
    const samples = [];
    let pending = Buffer.alloc(0);
    sockets.add(socket);
    const closed = new Promise(resolve => socket.once('close', () => { sockets.delete(socket); resolve(); }));
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 3 && pending.length >= 3 + pending.readUInt16BE(1)) {
        const length = pending.readUInt16BE(1);
        if (pending[0] === 0x10 && length >= 2 && pending.readInt16LE(3)) samples.push(pending.readInt16LE(3));
        pending = pending.subarray(3 + length);
      }
    });
    await new Promise(resolve => socket.once('connect', resolve));
    socket.write(packet(1, Buffer.from(uuid.replaceAll('-', ''), 'hex')));
    return { socket, samples, closed };
  }
  async function until(condition) {
    const deadline = Date.now() + 2500;
    while (!condition() && Date.now() < deadline) await delay(10);
    assert.ok(condition());
  }
  const metadata = agentUser => {
    const index = ++sequence;
    return { uuid: '3548' + randomUUID().slice(4), externalCallId: 'fixture-call-' + String(index).padStart(4, '0'), agentUser, asteriskUniqueid: 'fixture.' + index, asteriskLinkedid: 'fixture.' + index };
  };

  try {
    await Promise.all([listen(bridge.audio), listen(bridge.control)]);
    const users = Array.from({ length: 10 }, (_, i) => 'agent-' + i);
    for (const remoteUser of users) assert.equal((await control('/prepare', { connectionId, remoteUser })).status, 200);
    const failed = metadata(users[0]);
    failedId = failed.externalCallId;
    assert.equal((await control('/register', failed)).status, 200);
    await (await open(failed.uuid)).closed;
    assert.ok(!sessions.has(failedId));
    for (const count of [1, 1, 1, 2, 5, 10]) {
      const legs = await Promise.all(users.slice(0, count).map(async (user, i) => {
        const value = metadata(user);
        const started = performance.now();
        const leg = i % 2 ? await open(value.uuid) : null;
        if (leg) await delay(80);
        assert.equal((await control('/register', value)).status, 200);
        assert.equal((await control('/register', value)).status, 200);
        assert.equal((await control('/register', { ...value, externalCallId: failedId })).status, 409);
        const connected = leg || await open(value.uuid);
        await until(() => connected.samples.length >= 2);
        return { ...connected, value, firstPcmMs: Math.round(performance.now() - started) };
      }));
      const assertIsolated = ({ value, samples }) => assert.ok(samples.every(sample => sample === sessions.get(value.externalCallId).sample));
      legs.forEach(assertIsolated);
      assert.equal(new Set(legs.map(({ value }) => sessions.get(value.externalCallId).id)).size, count);
      const first = legs[0];
      const previousSamples = legs.map(leg => leg.samples.length);
      first.socket.destroy();
      await first.closed;
      await until(() => ended.has(sessions.get(first.value.externalCallId).id));
      if (count > 1) await until(() => legs.slice(1).every((leg, i) => leg.samples.length > previousSamples[i + 1]));
      legs.forEach(assertIsolated);
      for (const leg of legs.slice(1)) leg.socket.destroy();
      await Promise.all(legs.map(leg => leg.closed));
      await until(() => legs.every(({ value }) => ended.has(sessions.get(value.externalCallId).id)));
      console.log(count + ' loopback calls, first PCM ms ' + legs.map(leg => leg.firstPcmMs).join(', '));
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await delay(50);
    await bridge.flushEvents();
    bridge.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
