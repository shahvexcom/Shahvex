const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, deps) {
  const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(name => Object.hasOwn(deps, name) ? deps[name] : name === '@/lib/agent-test-stream' ? load('lib/agent-test-stream.ts', {}) : name === '@/lib/agent-script-extraction' ? { extractAgentScript: async () => load('lib/agent-script-details.ts', {}).emptyScriptDetails() } : name === '@/lib/agent-script-details' ? load('lib/agent-script-details.ts', {}) : name === '@/lib/agent-test-audio' ? load('lib/agent-test-audio.ts', {}) : require(name), mod, mod.exports); return mod.exports;
}
const service = load('lib/agent-test.ts', { 'server-only': {} });
const config = { name: 'Configured Agent', voice: 'local-voice', first: 'ai', goal: 'Schedule a consultation', task: 'Find availability', instructions: 'Be accurate', script: 'Ask about timing', knowledge: 'Open weekdays', style: 'Friendly' };
test('configuration and isolated server memory use assigned content and replace old owner sessions', () => {
  service.sessions.clear();
  const id = service.newTest('admin-a', 'agent-a', config), other = service.newTest('admin-b', 'agent-b', { ...config, name: 'Other' });
  const s = service.sessions.get(id);
  for (const text of [config.name, config.goal, config.script, config.knowledge, 'one task-related question', 'Introduce yourself once']) assert.ok(s.messages[0].content.includes(text));
  s.abort = new AbortController(); service.newTest('admin-a', 'agent-c', config);
  assert.equal(s.abort.signal.aborted, true); assert.equal(service.sessions.has(id), false); assert.equal(service.sessions.has(other), true);
  service.sessions.get(other).expires = 0; service.pruneSessions(); assert.equal(service.sessions.has(other), false);
});
test('test route requires admin, rejects foreign origins and isolates session handles', async () => {
  let role = 'AGENT';
  const route = load('app/api/admin/agent-test/route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test' }) }) },
    '@/lib/session': { ADMIN_SESSION_COOKIE: 'session', readSession: async () => ({ agentId: 'admin-a', role }) },
    '@/lib/database': { db: async () => { throw Error('Should not access database'); } },
    '@/lib/agent-test': service,
  });
  const req = (query, origin = 'http://localhost:3000') => new Request(`http://localhost:3000/api/admin/agent-test?${query}`, { method: 'POST', headers: { origin } });
  assert.equal((await route.GET(new Request('http://localhost:3000/api/admin/agent-test'))).status, 401);
  assert.equal((await route.POST(req('action=start'))).status, 401);
  role = 'ADMIN';
  assert.equal((await route.POST(req('action=start', 'https://foreign.example'))).status, 403);
  const id = service.newTest('admin-b', 'agent-b', config);
  assert.equal((await route.POST(req(`action=stop&id=${id}`))).status, 404);
  assert.ok(service.sessions.has(id));
});
test('starting a test enforces the saved agent name despite a client override', async () => {
  const route = load('app/api/admin/agent-test/route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test' }) }) },
    '@/lib/session': { ADMIN_SESSION_COOKIE: 'session', readSession: async () => ({ agentId: 'admin-a', role: 'ADMIN' }) },
    '@/lib/database': { db: async () => ({ query: async () => ({ rows: [{ id: 'agent-a', name: 'Saved Agent Name' }] }) }) },
    '@/lib/agent-test': { ...service, localVoices: async () => ({ voices: [{ id: config.voice }] }), warmSelectedVoice: async () => {} },
  });
  const response = await route.POST(new Request('http://localhost:3000/api/admin/agent-test?action=start', { method: 'POST', headers: { origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: 'agent-a', config: { ...config, name: 'Client Override' } }) }));
  assert.equal(response.status, 200);
  const session = service.sessions.get((await response.json()).id);
  assert.equal(session.config.name, 'Saved Agent Name');
  assert.ok(session.messages[0].content.includes('You are Saved Agent Name'));
  assert.ok(!session.messages[0].content.includes('Client Override'));
});
test('streamed turn sends selected voice, retains memory, and introduces only at session start', async () => {
  service.sessions.clear(); const id = service.newTest('admin-a', 'agent-a', config); const calls = [];
  const route = load('app/api/admin/agent-test/route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test' }) }) },
    '@/lib/session': { ADMIN_SESSION_COOKIE: 'session', readSession: async () => ({ agentId: 'admin-a', role: 'ADMIN' }) },
    '@/lib/database': {},
    '@/lib/agent-test': { ...service, engine: async (port, path, init) => {
      calls.push({ port, path, body: JSON.parse(init.body) });
      if (port === 11434) return new Response(JSON.stringify({ message: { content: 'Hello. How can I help?' }, done: true }) + '\n');
      return new Response(new Uint8Array(4800).fill(16), { headers: { 'x-audio-format': 'pcm_s16le', 'x-sample-rate': '24000', 'x-channels': '1' } });
    } },
  });
  const turn = body => route.POST(new Request(`http://localhost:3000/api/admin/agent-test?action=turn&id=${id}`, { method: 'POST', headers: { origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const opening = (await (await turn({ opening: true })).text()).trim().split('\n').map(JSON.parse);
  assert.ok(opening.some(e => e.type === 'pcm')); assert.ok(opening.some(e => e.type === 'delta')); assert.equal(opening.at(-1).type, 'done');
  assert.ok(calls.filter(c => c.port === 8767).every(c => c.body.voice_id === config.voice));
  await (await turn({ text: 'What time are you open?' })).text();
  const last = calls.filter(c => c.port === 11434).at(-1).body.messages;
  assert.equal(last.at(-1).content, 'What time are you open?'); assert.equal(last.at(-2).role, 'assistant');
  const repeated = await (await turn({ opening: true })).text(); assert.ok(repeated.includes('Message required'));
});
test('live Parakeet -> Ollama -> CosyVoice round trip', { skip: process.env.SHAHVEX_LIVE_AGENT_TEST !== '1', timeout: 180000 }, async () => {
  const voices = await service.localVoices();
  const speech = await service.engine(8767, '/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'What time are you open?', voice_id: voices.defaultVoice }) });
  assert.equal(speech.status, 200); const wav = await speech.arrayBuffer();
  const id = service.newTest('live-test-admin', 'live-test-agent', { ...config, voice: voices.defaultVoice });
  const route = load('app/api/admin/agent-test/route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test' }) }) },
    '@/lib/session': { ADMIN_SESSION_COOKIE: 'session', readSession: async () => ({ agentId: 'live-test-admin', role: 'ADMIN' }) },
    '@/lib/database': {}, '@/lib/agent-test': service,
  });
  const response = await route.POST(new Request(`http://localhost:3000/api/admin/agent-test?action=turn&id=${id}`, { method: 'POST', headers: { origin: 'http://localhost:3000', 'Content-Type': 'audio/wav' }, body: await (() => { const {decodeWav,resample}=require('../gateway/wav.cjs'); const d=decodeWav(Buffer.from(wav)), pcm=resample(d.audio,d.sampleRate,16000); return load('lib/agent-test-audio.ts',{}).speechWav([new Int16Array(pcm.buffer,pcm.byteOffset,pcm.byteLength/2)]).arrayBuffer(); })() }));
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.find(e => e.type === 'error'), undefined);
  assert.match(events.find(e => e.type === 'user').text, /time|open/i);
  assert.ok(events.some(e => e.type === 'delta'));
  const audio = events.find(e => e.type === 'pcm'); assert.ok(audio); assert.equal(audio.sampleRate, 24000); assert.equal(Buffer.from(audio.data, 'base64').length % 2, 0);
  assert.equal(events.at(-1).type, 'done'); service.sessions.delete(id);
});
test('live requested answer has three complete sentences and an example', { skip: process.env.SHAHVEX_LIVE_AGENT_TEST !== '1', timeout: 180000 }, async () => {
  const voices = await service.localVoices();
  const id = service.newTest('accuracy-test-admin', 'accuracy-test-agent', { ...config, first: 'customer', voice: voices.defaultVoice, goal: 'Answer questions accurately', task: 'Follow the requested format', script: '', knowledge: '', instructions: 'Follow the requested sentence count exactly. Include the example within the three sentences.' });
  const route = load('app/api/admin/agent-test/route.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'test' }) }) },
    '@/lib/session': { readSession: async () => ({ agentId: 'accuracy-test-admin', role: 'ADMIN' }) },
    '@/lib/database': {}, '@/lib/agent-test': service,
  });
  const r = await route.POST(new Request(`http://localhost:3000/api/admin/agent-test?action=turn&id=${id}`, { method: 'POST', headers: { origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Explain how AI calling agents help businesses in three simple sentences and give an example.' }) }));
  const events = (await r.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.find(e => e.type === 'error'), undefined);
  const answer = events.filter(e => e.type === 'delta').map(e => e.text).join('');
  assert.equal(answer.trim().split(/(?<=[.!?])\s+(?=[A-Z])/).length, 3, answer);
  assert.match(answer, /example|such as|for instance/i); assert.match(answer, /business|compan|customer/i);
  console.info('Accuracy sample:', answer);
  service.sessions.delete(id);
});
