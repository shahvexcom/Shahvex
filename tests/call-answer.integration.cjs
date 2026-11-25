'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Duplex } = require('node:stream');
const { randomUUID, randomBytes } = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { createCallAnswer } = require('../deployment/vicidial-bridge/call-answer.cjs');
const { createBridge, packet } = require('../deployment/vicidial-bridge/server.cjs');

const env = { ...process.env, DETECTION_MODE: '' };
assert.ok(env.DETECTION_SILERO_MODEL, 'Set DETECTION_SILERO_MODEL to the Silero ONNX file');
const config = { silenceMs: 800, tickMs: 20 };
const quiet = Buffer.alloc(512);
function tone(frequency, offset = 0, amplitude = 5000) {
  const frame = Buffer.alloc(512);
  for (let i = 0; i < 256; i++) frame.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * frequency * (i + offset) / 8000)), 2 * i);
  return frame;
}
const greeting = fs.readFileSync(path.join(env.DETECTION_TEST_PCM_DIR, 'greeting.pcm'));
const hello = fs.readFileSync(path.join(env.DETECTION_TEST_PCM_DIR, 'hello.pcm'));
const reply = fs.readFileSync(path.join(env.DETECTION_TEST_PCM_DIR, 'reply.pcm'));

async function until(find, limit = 4500) {
  const stop = performance.now() + limit;
  while (performance.now() < stop) {
    const value = find();
    if (value) return value;
    await wait(10);
  }
  assert.fail('Expected event did not arrive');
}

function spool() {
  const spoolDir = fs.mkdtempSync(path.join(env.DETECTION_TEST_PCM_DIR, 'spool-'));
  const events = () => {
    const log = path.join(spoolDir, 'call-answer.jsonl');
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trimEnd().split('\n')
      .filter(line => line.endsWith('}')).map(line => JSON.parse(line)) : [];
  };
  return { spoolDir, events };
}

async function fixture(t, overrides = {}, fixtureEnv = env) {
  const { spoolDir, events } = spool();
  const actions = [];
  const detector = createCallAnswer({ spoolDir, env: fixtureEnv, overrides: { ...config, mode:'live', ...overrides } });
  t.after(() => detector.close());
  if (fixtureEnv === env) await until(() => events().find(event => event.event === 'ready'));
  function start(id, connectedAt = Date.now()) {
    return detector.start(id, connectedAt, (decision, disposition) => {
      actions.push({ id, disposition, decision, at: performance.now() });
      return true;
    });
  }
  async function decision(id, classification) {
    const result = await until(() => events().find(event => event.callId === id && event.event === 'decision'));
    assert.equal(result.classification, classification);
    t.diagnostic(`${classification} at ${result.latencyMs} ms; ${result.signal}; wouldHangup=${result.wouldHangup}`);
    return result;
  }
  return { spoolDir, events, actions, start, decision };
}

async function play(handle, pcm, frameTime = 12) {
  for (let i = 0; i + 512 <= pcm.length; i += 512) {
    handle.audio(pcm.subarray(i, i + 512), false);
    await wait(frameTime);
  }
}

for (const [name, makeFrame] of [
  ['digital silence', () => quiet],
  ['quiet 60 Hz hum', index => tone(60, index * 256, 350)],
]) {
  test(name + ' yields one SILENCE hangup with NA', async t => {
    const f = await fixture(t);
    const call = f.start(name);
    if (makeFrame) for (let i = 0; i < 28; i++) { call.audio(makeFrame(i), false); await wait(20); }
    const result = await f.decision(name, 'SILENCE');
    assert.ok(result.latencyMs >= config.silenceMs - 2);
    await until(() => f.actions.length);
    await wait(60);
    assert.deepEqual(f.actions.map(x => x.disposition), ['NA']);
  });
}

test('no observed PCM is undetermined and is audited exactly once in shadow', async t => {
  const f = await fixture(t, { mode:'shadow' });
  const call = f.start('no-pcm');
  call.transcript('Hello', false);
  assert.equal((await f.decision('no-pcm', 'UNDETERMINED')).signal, 'no_observed_pcm');
  call.close();
  const auditFile = path.join(f.spoolDir, 'call-answer-shadow.jsonl');
  await until(() => fs.existsSync(auditFile) && fs.readFileSync(auditFile, 'utf8').endsWith('\n'));
  const rows = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].call_id, 'no-pcm');
  assert.equal(rows[0].final_status, null);
  assert.equal(rows[0].would_hangup, false);
  assert.equal(rows[0].transcript_so_far[0].text, 'Hello');
});

test('sustained loud line audio does not qualify as silence', async t => {
  const f = await fixture(t, { loudNonSpeechMs:320 });
  const call = f.start('loud');
  for (let i = 0; i < 20; i++) {
    call.audio(tone(60, i * 256, 4000), false);
    await wait(20);
  }
  assert.equal((await f.decision('loud', 'UNDETERMINED')).signal, 'sustained_loud_audio');
  assert.equal(f.actions.length, 0);
});

test('one PCM frame cannot establish silence', async t => {
  const f = await fixture(t, { mode:'shadow' });
  const call = f.start('sparse');
  call.audio(quiet, false);
  assert.equal((await f.decision('sparse', 'UNDETERMINED')).signal, 'insufficient_pcm_coverage');
  assert.equal(f.actions.length, 0);
});

test('audit-only customer text vetoes a shadow silence decision', async t => {
  const f = await fixture(t, { mode:'shadow' });
  const call = f.start('customer-text');
  for (let i = 0; i < 28; i++) {
    call.audio(quiet, false);
    if (i === 8) call.transcript('Okay.', false);
    await wait(24);
  }
  assert.equal((await f.decision('customer-text', 'UNDETERMINED')).signal, 'transcript_speech_evidence');
  assert.equal(f.actions.length, 0);
});

test('playback coverage gap does not qualify as silence', async t => {
  const f = await fixture(t, { maxMaskedSilenceMs:300 });
  const call = f.start('masked');
  call.audio(quiet, false);
  call.playback();
  assert.equal((await f.decision('masked', 'UNDETERMINED')).signal, 'playback_coverage_gap');
  assert.equal(f.actions.length, 0);
});

test('hello, pause, and reply confirms HUMAN and stops inference', async t => {
  const f = await fixture(t, { silenceMs: 1800 });
  const call = f.start('human');
  await play(call, hello);
  call.transcript('Hello');
  call.audio(quiet, true);
  await wait(470);
  call.audio(quiet, false);
  await play(call, reply);
  call.transcript('Yes I can hear you');
  await f.decision('human', 'HUMAN');
  call.transcript('Leave a message after the beep');
  await wait(70);
  assert.equal(f.actions.length, 0);
  t.diagnostic('False hangups on interactive fixture: 0/1');
});

test('long offline greeting remains a low-confidence voicemail candidate', async t => {
  const f = await fixture(t, { silenceMs: 1800, longGreetingMs: 900 });
  const call = f.start('long');
  await play(call, greeting);
  const result = await f.decision('long', 'UNDETERMINED');
  assert.ok(result.signals.includes('long_utterance'));
  assert.equal(f.actions.length, 0);
});

test('greeting plus sustained beep is actionable within one second of onset', async t => {
  const f = await fixture(t, { silenceMs: 1600 });
  const call = f.start('beep');
  await play(call, greeting.subarray(0, 104000));
  call.transcript('The subscriber is temporarily unavailable');
  const at = performance.now();
  for (let i = 0; i < 10; i++) { call.audio(tone(1000, i * 256), false); await wait(32); }
  await f.decision('beep', 'VOICEMAIL');
  await until(() => f.actions.length);
  const elapsed = Math.round(f.actions[0].at - at);
  t.diagnostic(`Beep onset to callback: ${elapsed} ms`);
  assert.ok(elapsed < 1000);
  assert.equal(f.actions[0].disposition, 'AA');
});

for (const mode of ['live', 'shadow']) {
  test(`existing transcript keywords in ${mode} mode`, async t => {
    const f = await fixture(t, { mode });
    const call = f.start(mode);
    const at = performance.now();
    call.transcript('Please leave a message after the beep');
    await f.decision(mode, 'VOICEMAIL');
    if (mode === 'live') {
      await until(() => f.actions.length);
      t.diagnostic(`Transcript to callback: ${Math.round(f.actions[0].at - at)} ms`);
      assert.equal(f.actions[0].disposition, 'AA');
    } else {
      assert.equal(f.actions.length, 0);
    }
  });
}

test('continuous music-like audio is reported as TV/BACKGROUND at conservative confidence', async t => {
  const f = await fixture(t, { backgroundMs: 900, silenceMs: 2000 });
  const call = f.start('music');
  const notes = [523.25, 659.25, 783.99, 880, 587.33, 698.46];
  for (let i = 0; i < 48; i++) {
    call.audio(tone(notes[Math.floor(i / 8)], i * 256), false);
    await wait(20);
  }
  const result = await f.decision('music', 'TV/BACKGROUND');
  assert.equal(result.wouldHangup, false);
  assert.equal(f.actions.length, 0);
});

test('live background disposition follows the configured confidence threshold', async t => {
  const f = await fixture(t, { backgroundMs:350, silenceMs:1200, hangupConfidence:0.75, HANGUP_ON_TV:true });
  const call = f.start('music-live');
  for (let i = 0; i < 20; i++) {
    call.audio(tone(i < 10 ? 625 : 875, i * 256), false);
    await wait(24);
  }
  const decision = await f.decision('music-live', 'TV/BACKGROUND');
  assert.equal(decision.wouldHangup, true);
  await until(() => f.actions.length);
  assert.deepEqual(f.actions.map(action => action.disposition), ['NA']);
});

test('background hangup is disabled by default even above threshold', async t => {
  const f = await fixture(t, { backgroundMs:350, silenceMs:1200, hangupConfidence:0.75 });
  const call = f.start('music-default');
  for (let i = 0; i < 20; i++) {
    call.audio(tone(i < 10 ? 625 : 875, i * 256), false);
    await wait(24);
  }
  assert.equal((await f.decision('music-default', 'TV/BACKGROUND')).wouldHangup, false);
  assert.equal(f.actions.length, 0);
});

test('late speech restarts the deadline and preserves the call by default', async t => {
  const f = await fixture(t, { silenceMs: 1500 });
  const start = performance.now();
  const call = f.start('late');
  await wait(600);
  await play(call, hello);
  call.transcript('Hello');
  await wait(950);
  assert.equal(f.actions.length, 0);
  const result = await f.decision('late', 'UNDETERMINED');
  assert.equal(result.signal, 'inactive_after_speech');
  assert.equal(result.wouldHangup, false);
  assert.ok(performance.now() - start >= 2100);
  assert.equal(f.actions.length, 0);
});

test('overflow preserves calls', async t => {
  const f = await fixture(t, { queueFrames: 2 });
  const call = f.start('overflow');
  for (let i = 0; i < 100; i++) call.audio(quiet, false);
  await until(() => f.events().find(event => event.reason === 'queue_overflow'));
  await wait(900);
  assert.equal(f.actions.length, 0);
});

test('Silero initialization error preserves calls', async t => {
  const f = await fixture(t, {}, { ...env, DETECTION_SILERO_MODEL: '/missing-test-model.onnx' });
  f.start('error');
  await until(() => f.events().find(event => event.reason === 'silero_initialization_failed'));
  await wait(900);
  assert.equal(f.actions.length, 0);
});

test('inference exception preserves an active call', async t => {
  const runtime = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'call-answer-runtime-')), 'index.cjs');
  t.after(() => fs.rmSync(path.dirname(runtime), { recursive:true, force:true }));
  fs.writeFileSync(runtime, `
    let frames = 0;
    exports.Tensor = class {};
    exports.InferenceSession = { create: async () => ({ run: async () => {
      if (frames++) throw Error('fixture inference failure');
      return { output: { data: [0] }, stateN: {} };
    } }) };
  `);
  const f = await fixture(t, {}, { ...env, DETECTION_ONNX_RUNTIME: runtime });
  await until(() => f.events().find(event => event.event === 'ready'));
  f.start('error').audio(quiet, false);
  await until(() => f.events().find(event => event.reason === 'classifier_exception'));
  await wait(900);
  assert.equal(f.actions.length, 0);
});

test('simultaneous calls and runtime kill switch', async t => {
  const f = await fixture(t);
  const silent = f.start('silent');
  f.start('machine').transcript('Please leave a message after the beep');
  for (let i = 0; i < 28; i++) { silent.audio(quiet, false); await wait(24); }
  await f.decision('machine', 'VOICEMAIL');
  await f.decision('silent', 'SILENCE');
  await until(() => f.actions.length === 2);
  assert.deepEqual(f.actions.map(action => action.id), ['machine', 'silent']);
  f.start('disabled');
  fs.writeFileSync(path.join(f.spoolDir, 'call-answer.disabled'), '');
  await until(() => f.events().find(event => event.callId === 'disabled' && event.reason === 'disabled'));
  assert.equal(f.actions.length, 2);
});

function attachAudioSocket(bridge, t) {
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, done) { done(); },
    final(done) { this.push(null); done(); },
  });
  socket.setNoDelay = () => {};
  bridge.audio.emit('connection', socket);
  t.after(() => socket.destroy());
  socket.push(packet(1, randomBytes(16)));
  return socket;
}

test('AudioSocket cancels opening playback before submitting classified hangup', { timeout: 35000 }, async t => {
  const { spoolDir, events } = spool();
  const calls = [];
  let openingSignal;
  const callId = randomUUID();
  const bridge = createBridge({
    callAnswerOptions: { env, overrides: { mode:'live', silenceMs:800, tickMs:20 } },
    spoolDir, siteUrl:'https://fixture.invalid/', connectionId: randomUUID(), secret:'fixture-secret'.repeat(3),
    logger() {},
    resolveRegistration: async uuid => ({ uuid, audioUuid:uuid, externalCallId:`direct-${uuid.replaceAll('-', '')}`, agentUser:'fixture' }),
    fetchImpl: async (_, init) => {
      const request = JSON.parse(init.body);
      if (request.action === 'connected') return Response.json({ callId, first:'assistant', mediaReady:true });
      if (request.action === 'turn') {
        openingSignal = init.signal;
        return await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once:true }));
      }
      if (request.action === 'hangup') calls.push({ request, openingAborted:openingSignal?.aborted });
      return Response.json({ saved:true, ended:true });
    },
  });
  t.after(() => bridge.close());
  await until(() => events().find(event => event.event === 'ready'));
  const socket = attachAudioSocket(bridge, t);
  await until(() => openingSignal);
  for (let i = 0; i < 28; i++) { socket.push(packet(0x10, quiet)); await wait(24); }
  await until(() => calls.length);
  assert.equal(calls[0].openingAborted, true);
  assert.equal(calls[0].request.endInitiation.reason, 'call_answer_detection');
  assert.equal(calls[0].request.endInitiation.disposition, 'NA');
  await wait(80);
  assert.equal(calls.length, 1);
  const { latencyMs } = events().find(event => event.event === 'decision');
  assert.ok(latencyMs >= 800 && latencyMs <= 1200);
  t.diagnostic(`Bridge observed silence decision: ${latencyMs} ms`);
});

test('24 simultaneous 8 kHz streams, paced at 32 ms', async t => {
  const f = await fixture(t, { silenceMs: 2400, queueFrames: 64 });
  const calls = Array.from({ length:24 }, (_, index) => f.start(String(index)));
  const before = process.cpuUsage();
  const start = performance.now();
  let tapMs = 0;
  const frames = 64;
  for (let i = 0; i < frames; i++) {
    const begin = performance.now();
    for (const call of calls) call.audio(quiet, false);
    tapMs += performance.now() - begin;
    await wait(Math.max(1, start + (i+1)*32 - performance.now()));
  }
  const elapsed = performance.now() - start;
  const cpu = process.cpuUsage(before);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  const chunks = calls.length * frames;
  t.diagnostic(`24 calls, ${chunks} chunks, ${(cpuMs / elapsed * 100).toFixed(1)}% of one CPU, ${(cpuMs / chunks).toFixed(3)} ms CPU/chunk, ${(tapMs * 1000 / chunks).toFixed(1)} μs synchronous tap/chunk`);
  await until(() => f.actions.length === 24);
  assert.equal(f.events().filter(event => event.reason === 'queue_overflow').length, 0);
});

test('native hangup dry run sends the exact caller code and persists the disposition', async t => {
  const ts = require('typescript');
  const call = {
    id: 'fixture-call', status:'ANSWERED', telephony_provider:'AUDIOSOCKET',
    vicidial_call_id:'EXACT-FIXTURE-CALLER', vicidial_agent_user:'fixture',
    end_initiation: { reason:'call_answer_detection', disposition:'AA' },
  };
  const updates = [];
  const commands = [];
  const modules = {
    './database': { db: async () => ({ query: async (sql, args) => {
      if (sql.startsWith('SELECT')) return { rows: [call] };
      updates.push({ sql, args });
      return { rowCount: 1 };
    } }) },
    './credential-crypto': { decryptCredential: value => value },
    './vicidial-results': {},
    './vicidial-config': {},
    './vicidial-bridge': {},
    './vicidial': {
      vicidialRequest: async (_url, _user, _secret, fields) => {
        commands.push(fields);
        return 'SUCCESS: ra_call_control hungup';
      },
      requireVicidialSuccess: value => assert.match(value, /^SUCCESS:/),
    },
  };
  const compiled = ts.transpileModule(fs.readFileSync('lib/vicidial-controls.ts','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => modules[name], module, module.exports);
  const { vicidialCallCommand } = module.exports;
  const result = await vicidialCallCommand(call.id, 'hangup', undefined, false, true, 'AA');
  assert.equal(result.status, 200);
  assert.deepEqual(commands, [{
    function: 'ra_call_control', agent_user:'fixture', value:'EXACT-FIXTURE-CALLER', stage:'HANGUP', status:'AA',
  }]);
  assert.match(updates[0].sql, /nativeSubmitted/);
  assert.match(updates[0].sql, /outcome=COALESCE/);
  assert.deepEqual(updates[0].args, [call.id, null, 'AA']);
  t.diagnostic('One exact-ID HANGUP request with status AA and one website outcome update');
});

test('AudioSocket replays voicemail, music, and interactive speech through the bridge', { timeout: 20000 }, async t => {
  const { spoolDir, events } = spool();
  const labels = ['machine','music','human'];
  const ids = Object.fromEntries(labels.map(label => [label, randomUUID()]));
  const byExternal = new Map();
  const requests = [];
  let admitted = 0;
  let humanProbes = 0;
  const bridge = createBridge({
    callAnswerOptions: { env, overrides: { mode:'live', silenceMs:2200, backgroundMs:650, tickMs:30 } },
    spoolDir, siteUrl:'https://fixture.invalid/', connectionId:randomUUID(), secret:'media-fixture-secret'.repeat(3),
    logger() {},
    resolveRegistration: async uuid => ({ uuid, audioUuid:uuid, externalCallId:`direct-${uuid.replaceAll('-', '')}`, agentUser:'fixture' }),
    fetchImpl: async (_, init) => {
      const request = JSON.parse(init.body);
      requests.push(request);
      if (request.action === 'connected') {
        const label = labels[admitted++];
        byExternal.set(request.externalCallId, label);
        return Response.json({ callId:ids[label], first:'customer', mediaReady:true });
      }
      const label = byExternal.get(request.externalCallId);
      if (request.action === 'listen') {
        const text = label === 'machine' ? 'Please leave a message after the beep'
          : label === 'human' ? (++humanProbes === 1 ? 'Hello' : 'Yes I can hear you') : '';
        return Response.json({ text, confidence:0.99 });
      }
      if (request.action === 'turn') {
        return new Response([
          { type:'pcm', sampleRate:24000, data:Buffer.alloc(4800, 12).toString('base64') },
          { type:'done' },
        ].map(ev => JSON.stringify({ ...ev, turnId:request.eventId })).join('\n') + '\n');
      }
      return Response.json({ saved:true, ended:request.action === 'hangup' });
    },
  });
  t.after(() => bridge.close());
  await until(() => events().find(event => event.event === 'ready'));
  async function open(label) {
    const socket = attachAudioSocket(bridge, t);
    await until(() => events().find(event => event.callId === ids[label] && event.event === 'start'));
    return socket;
  }
  async function send(socket, pcm) {
    for (let offset = 0; offset + 320 <= pcm.length; offset += 320) {
      socket.push(packet(0x10, pcm.subarray(offset, offset + 320)));
      await wait(15);
    }
  }
  const machine = await open('machine');
  await send(machine, greeting.subarray(0, 28000));
  const hangup = await until(() => requests.find(request => request.callId === ids.machine && request.action === 'hangup'));
  assert.equal(hangup.endInitiation.disposition, 'AA');

  const music = await open('music');
  const tones = Buffer.concat(Array.from({ length:32 }, (_, i) => tone(i < 16 ? 625 : 875, i * 256)));
  await send(music, tones);
  const musicResult = await until(() => events().find(event => event.callId === ids.music && event.event === 'decision'));
  assert.equal(musicResult.classification, 'TV/BACKGROUND');
  assert.equal(musicResult.wouldHangup, false);
  music.push(packet(0));

  const human = await open('human');
  await send(human, hello);
  await until(() => requests.find(request => request.callId === ids.human && request.action === 'turn'));
  await wait(450);
  await send(human, reply);
  const humanResult = await until(() => events().find(event => event.callId === ids.human && event.event === 'decision'));
  assert.equal(humanResult.classification, 'HUMAN');
  assert.equal(requests.filter(request => request.action === 'hangup').length, 1);
  t.diagnostic(`AudioSocket music decision ${musicResult.latencyMs} ms; interactive decision ${humanResult.latencyMs} ms; one machine hangup`);
});
