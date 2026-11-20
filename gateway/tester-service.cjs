'use strict';
// Standalone AI-only Node service. Reuses the existing tester; never loads DB/auth.
const http = require('node:http');
const {FLOW_REVISION}=require('./conversation-resume.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const allowed = new Set(['agent-context-answer', 'agent-test', 'agent-test-session', 'agent-test-stream', 'agent-test-audio', 'agent-test-speculative', 'agent-script-extraction', 'agent-script-details']);
function loader() {
  const cache = new Map();
  function load(name) {
    const key = name.replace(/^@\/lib\//, '').replace(/^\.\//, '');
    if (name === 'server-only') return {};
    if (!allowed.has(key)) return require(name);
    if (cache.has(key)) return cache.get(key).exports;
    const mod = { exports: {} }; cache.set(key, mod);
    const source = fs.readFileSync(path.join(root, 'lib', key + '.ts'), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(load, mod, mod.exports);
    return mod.exports;
  }
  return load;
}
function createTesterService({ secret, maxSessions = 1, leaseMs = 90000, now = Date.now, load = loader(), testHooks = false, capacityControl } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('PC AI secret of at least 32 characters required');
  maxSessions = Math.max(1, Math.min(300, Number(maxSessions) || 1));
  const ai = load('agent-test');
  const { handleTestSession } = load('agent-test-speculative');
  const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  let capacityChanging=false;
  const warmingOpenings = new Map();
  function warmOpening(config) {
    if (typeof ai.engine !== 'function') return;
    const text = load('agent-context-answer').briefAgentOpening(config);
    if (!text) return;
    const key = JSON.stringify([config.voice, text]);
    if (warmingOpenings.has(key)) return;
    const work = load('agent-test-stream').streamAgentReply({
      messages: [], fixedSpeech: text, voice: config.voice, openingAudio: true, cacheAudio: true,
      signal: AbortSignal.timeout(15000), engine: ai.engine,
      send: async () => {}, timing: async () => {}, onText: () => {},
    }).catch(() => {}).finally(() => warmingOpenings.delete(key));
    warmingOpenings.set(key, work);
  }
  async function dispatch(request) {
    const got = Buffer.from(request.headers.get('x-shahvex-ai-key') || '');
    const expected = Buffer.from(secret);
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return json(401, { error: 'Unauthorized' });
    const url = new URL(request.url);
    if(url.pathname==='/internal/status'&&request.method==='GET')return json(200,{sessions:ai.sessions.size,busy:[...ai.sessions.values()].filter(s=>s.busy).length,capacity:maxSessions,flowRevision:FLOW_REVISION});
    if(url.pathname==='/internal/capacity'&&!url.search){
      if(!capacityControl)return json(503,{error:'Capacity management is not configured'});
      if(request.method==='GET'){try{return json(200,await capacityControl.read(maxSessions));}catch{return json(503,{error:'Cannot read live call capacity; check the audio bridges'});}}
      if(request.method!=='POST')return json(405,{error:'Method not allowed'});
      const text=await request.text();if(text.length>100)return json(413,{error:'Too large'});
      let value;try{value=JSON.parse(text).limit;}catch{return json(400,{error:'Invalid capacity'});}
      if(!Number.isInteger(value)||value<1||value>300)return json(400,{error:'Choose a whole number from 1 to 300'});
      if(capacityChanging)return json(409,{error:'Another capacity update is in progress'});
      if(ai.sessions.size>value)return json(409,{error:'Finish active sessions before lowering the limit below current usage'});
      capacityChanging=true;
      try{const state=await capacityControl.set(value,maxSessions);maxSessions=value;return json(200,{...state,limit:value});}
      catch(error){return json(error.status===409?409:503,{error:error.publicMessage||'Capacity update was not confirmed; check the audio bridges'});}
      finally{capacityChanging=false;}
    }
    const match = /^\/tester\/(start|extract|listen|turn|draft|commit|cancel|interrupt|stop|ping|playback-complete)$/.exec(url.pathname);
    const engineMatch = /^\/engine\/(11434\/api\/chat|8766\/transcribe|8767\/(?:voices|health|synthesize|stream))$/.exec(url.pathname);
    if (url.search || (!match && !engineMatch)) return json(404, { error: 'Unsupported operation' });
    if (engineMatch) {
      const operation = engineMatch[1];
      const method = /8767\/(voices|health)$/.test(operation) ? 'GET' : 'POST';
      if (request.method !== method) return json(404, { error: 'Unsupported operation' });
      const chunks = []; let size = 0;
      if (request.body) for await (const chunk of request.body) {
        size += chunk.length; if (size > 2_100_000) return json(413, { error: 'Request too large' }); chunks.push(chunk);
      }
      const slash = operation.indexOf('/');
      let upstream;
      try { upstream = await ai.engine(Number(operation.slice(0, slash)), operation.slice(slash), {
        method, signal: request.signal,
        headers: request.headers.has('content-type') ? { 'content-type': request.headers.get('content-type') } : {},
        ...(method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      }); } catch { return json(503, { error: 'AI service unavailable' }); }
      if (!upstream.ok) { await upstream.body?.cancel(); return json([400,404,409,413,422,429].includes(upstream.status) ? upstream.status : 502, { error: 'AI operation failed' }); }
      const headers = new Headers({ 'cache-control': 'no-store' });
      for (const name of ['content-type','x-audio-format','x-sample-rate','x-channels']) if(upstream.headers.has(name))headers.set(name,upstream.headers.get(name));
      return new Response(upstream.body, {headers});
    }
    if (request.method !== 'POST') return json(404, { error: 'Unsupported operation' });
    const owner = request.headers.get('x-shahvex-owner');
    if (!owner || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) return json(400, { error: 'Invalid owner' });
    const chunks = []; let size = 0;
    if (request.body) for await (const chunk of request.body) {
      size += chunk.length; if (size > 2_000_000) return json(413, { error: 'Request too large' }); chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    ai.pruneSessions();
    // Reclaim abandoned tabs, never a worker that is still running.
    for(const [id,s] of ai.sessions)if(!s.busy && now()-(s.lastSeen || 0)>leaseMs){s.abort?.abort();ai.sessions.delete(id);}
    if (match[1] === 'extract') {
      if (body.length > 70000) return json(413, { error: 'Script too large' });
      let input; try { input = JSON.parse(body.toString()); } catch { return json(400, { error: 'Invalid JSON' }); }
      if (typeof input.script !== 'string' || input.script.length > 16000) return json(400, { error: 'Invalid script' });
      try { return json(200, await load('agent-script-extraction').extractAgentScript(owner, input.script, request.signal)); }
      catch { return json(503, { error: 'Script extraction unavailable' }); }
    }
    if (match[1] === 'start') {
      if(capacityChanging)return json(409,{error:'Call capacity is updating; retry shortly'});
      if (body.length > 70000) return json(413, { error: 'Configuration too large' });
      let input; try { input = JSON.parse(body.toString()); } catch { return json(400, { error: 'Invalid JSON' }); }
      const parsed = ai.testConfig.safeParse(input.config);
      if (!parsed.success || typeof input.agentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.agentId)) return json(400, { error: 'Invalid configuration' });
      let config=parsed.data;
      if(input.deriveFromScript===true){
        if([...ai.sessions.values()].filter(s=>s.owner!==owner).length>=maxSessions)return json(429,{error:'Another test session is active. End that session and try again.',code:'CAPACITY'});
        try{
          const details=await load('agent-script-extraction').extractAgentScript(owner,config.script,request.signal);
          config=ai.testConfig.parse(load('agent-script-details').scriptTestConfig(config,details));
          await ai.warmSelectedVoice(config.voice);
        }catch{return json(503,{error:'Script extraction or selected voice is unavailable'});}
      }
      // No awaits between admission and allocation; single-process admission is atomic.
      const others = [...ai.sessions.values()].filter(s => s.owner !== owner).length;
      if (others >= maxSessions) return json(429, { error: 'Another test session is active. End that session and try again.', code:'CAPACITY' });
      warmOpening(config); // Prepare audio while media admission proceeds.
      const sessionId=ai.newTest(owner,input.agentId,config);
      const session=ai.sessions.get(sessionId);
      if(session)session.requirePlaybackAck=input.requirePlaybackAck===true;
      return json(200, { id:sessionId,flowRevision:FLOW_REVISION,...(input.deriveFromScript===true?{derivedFromScript:true}:{}) });
    }
    const id = request.headers.get('x-shahvex-session') || '';
    const turn = request.headers.get('x-shahvex-turn') || crypto.randomUUID();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !/^[a-zA-Z0-9_-]{1,80}$/.test(turn)) return json(400, { error: 'Invalid session or turn' });
    const target = new URL('http://127.0.0.1/tester');
    target.searchParams.set('action', match[1]); target.searchParams.set('id', id); target.searchParams.set('turnId', turn);
    return handleTestSession(new Request(target, { method: 'POST', headers: { 'content-type': request.headers.get('content-type') || 'application/json', 'x-shahvex-turn-final':request.headers.get('x-shahvex-turn-final')||'0' }, body, signal: request.signal }), owner, true);
  }
  const server = http.createServer(async (req, res) => {
    const abort = new AbortController();
    res.once('close', () => { if (!res.writableFinished) abort.abort(); });
    try {
      const request = new Request(new URL(req.url, 'http://127.0.0.1'), { method: req.method, headers: req.headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}), signal: abort.signal });
      const response = await dispatch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end();
    } catch { if (!res.headersSent) res.writeHead(503, { 'cache-control': 'no-store' }); res.end(); }
  });
  server.requestTimeout = 130000;
  return { server, dispatch, ...(testHooks ? { sessionStore: ai.sessions } : {}) };
}
if (require.main === module) {
  // A transport flag on this process would recursively send inference upstream.
  if (process.env.SHAHVEX_PC_AI_URL) throw Error('Unset SHAHVEX_PC_AI_URL on the PC tester service');
  const { server } = createTesterService({ secret: process.env.SHAHVEX_PC_AI_SECRET, maxSessions: process.env.SHAHVEX_PC_AI_MAX_SESSIONS, capacityControl: require('./call-capacity.cjs').createCapacityControl({root}) });
  server.listen(Number(process.env.SHAHVEX_PC_TESTER_PORT || 8774), '127.0.0.1', () => process.stdout.write('PC AI adapter listening on loopback\n'));
}
module.exports = { createTesterService };

