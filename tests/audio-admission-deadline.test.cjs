const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { createBridge, packet } = require('../deployment/vicidial-bridge/server.cjs');

test('a stalled AudioSocket admission closes after 10 seconds while a recovered silent call stays linked', { timeout: 15000 }, async () => {
  const spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-admission-'));
  const stalled = crypto.randomUUID();
  const recovered = crypto.randomUUID();
  const sockets = [];
  let aborted = false;
  let turns = 0;
  const bridge = createBridge({
    siteUrl: 'https://fixture.invalid/',
    connectionId: crypto.randomUUID(),
    secret: 'audio-admission-fixture-'.repeat(4),
    spoolDir,
    logger: () => {},
    resolveRegistration: async (uuid, signal) => {
      if (uuid === stalled) {
        try { await delay(30000, null, { signal }); }
        catch (error) { aborted = signal.aborted; throw error; }
      }
      return { uuid, audioUuid: uuid, externalCallId: 'direct-' + uuid.replaceAll('-', ''), agentUser: '78611' };
    },
    fetchImpl: async (_url, init) => {
      const event = JSON.parse(init.body);
      if (event.action === 'connected') return Response.json({ callId: crypto.randomUUID(), first: 'customer' });
      if (event.action === 'media-ready') await delay(250);
      if (event.action === 'turn') turns++;
      return Response.json({ saved: true });
    },
  });
  try {
    bridge.audio.listen(0, '127.0.0.1');
    await once(bridge.audio, 'listening');
    async function connect(uuid) {
      const socket = net.connect(bridge.audio.address().port, '127.0.0.1');
      sockets.push(socket);
      await once(socket, 'connect');
      socket.write(packet(1, Buffer.from(uuid.replaceAll('-', ''), 'hex')));
      return socket;
    }
    const started = performance.now();
    const failed = await connect(stalled);
    const closed = once(failed, 'close');
    const silent = await connect(recovered);
    silent.write(packet(0x10, Buffer.alloc(320)));
    await closed;
    const elapsed = Math.round(performance.now() - started);
    console.log(`Stalled AudioSocket closed in ${elapsed} ms`);
    assert.ok(elapsed >= 9900 && elapsed < 11000);
    assert.equal(aborted, true);
    assert.equal(silent.destroyed, false);
    assert.equal(turns, 0);
  } finally {
    for (const socket of sockets) socket.destroy();
    bridge.close();
    await delay(50);
    await bridge.flushEvents();
    fs.rmSync(spoolDir, { recursive: true, force: true });
  }
});

test('five overlapping AudioSocket sessions carry separate caller and agent PCM', { timeout: 6000 }, async () => {
  const spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-pcm-'));
  const lines = new Map(Array.from({ length: 5 }, (_, index) => [
    crypto.randomUUID(), { callId: crypto.randomUUID(), sample: 1200 + index * 200, received: 0, recognized: 0 },
  ]));
  const sockets = [];
  const bridge = createBridge({
    siteUrl: 'https://fixture.invalid/',
    connectionId: crypto.randomUUID(),
    secret: 'audio-pcm-fixture-'.repeat(4),
    spoolDir,
    logger: () => {},
    maxCalls: 5,
    resolveRegistration: async uuid => ({
      uuid, audioUuid: uuid, externalCallId: 'direct-' + uuid.replaceAll('-', ''), agentUser: '78611',
    }),
    fetchImpl: async (_url, init) => {
      const event = JSON.parse(init.body);
      const hex = event.externalCallId.slice('direct-'.length);
      const line = [...lines].find(([uuid]) => uuid.replaceAll('-', '') === hex)?.[1];
      if (event.action === 'connected') return Response.json({ callId: line.callId, first: 'customer', mediaReady: true });
      if (event.action === 'listen') {
        assert.equal(event.callId, line.callId);
        const waveform = Buffer.from(event.audio, 'base64');
        assert.equal(waveform.toString('ascii', 0, 4), 'RIFF');
        assert.equal(waveform.readInt16LE(44), line.sample);
        line.recognized = waveform.length - 44;
        return Response.json({ text: 'I live in Arizona.' });
      }
      if (event.action === 'turn') {
        assert.equal(event.callId, line.callId);
        const wave = Buffer.alloc(4800);
        for (let offset = 0; offset < wave.length; offset += 2) wave.writeInt16LE(-line.sample, offset);
        return new Response(JSON.stringify({ type: 'pcm', sampleRate: 24000, data: wave.toString('base64') }) + '\n' +
          JSON.stringify({ type: 'done', turnId: event.eventId }) + '\n');
      }
      return Response.json({ saved: true });
    },
  });
  try {
    bridge.audio.listen(0, '127.0.0.1');
    await once(bridge.audio, 'listening');
    await Promise.all([...lines].map(async ([uuid, line]) => {
      const socket = net.connect(bridge.audio.address().port, '127.0.0.1');
      sockets.push(socket);
      let pending = Buffer.alloc(0);
      socket.on('data', data => {
        pending = Buffer.concat([pending, data]);
        while (pending.length >= 3 && pending.length >= 3 + pending.readUInt16BE(1)) {
          const size = pending.readUInt16BE(1);
          if (pending[0] === 0x10) {
            line.received += size;
            for (let index = 3; index < 3 + size; index += 2) {
              if (Math.abs(pending.readInt16LE(index) + line.sample) < 5) line.correctSample = true;
            }
          }
          pending = pending.subarray(3 + size);
        }
      });
      await once(socket, 'connect');
      const frame = Buffer.alloc(320);
      for (let offset = 0; offset < frame.length; offset += 2) frame.writeInt16LE(line.sample, offset);
      socket.write(Buffer.concat([
        packet(1, Buffer.from(uuid.replaceAll('-', ''), 'hex')),
        ...Array.from({ length: 12 }, () => packet(0x10, frame)),
      ]));
    }));
    const deadline = performance.now() + 3500;
    while ([...lines.values()].some(line => line.received < 1600) && performance.now() < deadline) await delay(25);
    for (const line of lines.values()) {
      assert.equal(line.recognized, 7680);
      assert.ok(line.received >= 1600);
      assert.equal(line.correctSample, true);
    }
    console.log('Five simultaneous sessions each carried 7680 inbound 16 kHz PCM bytes and at least 1600 outbound 8 kHz PCM bytes');
  } finally {
    for (const socket of sockets) socket.destroy();
    bridge.close();
    await delay(50);
    await bridge.flushEvents();
    fs.rmSync(spoolDir, { recursive: true, force: true });
  }
});
