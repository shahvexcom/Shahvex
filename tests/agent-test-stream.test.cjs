const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const code = ts.transpileModule(fs.readFileSync('lib/agent-test-stream.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
const { streamAgentReply } = mod.exports;
const pcmHeaders = { 'x-audio-format': 'pcm_s16le', 'x-sample-rate': '24000', 'x-channels': '1' };
const enc = new TextEncoder();
test('LLM completes while first TTS is in flight; first PCM precedes synthesis completion and sentences stay ordered', async () => {
  const events = [], spoken = [], timings = []; let release, completed = false, text = '';
  const waiting = new Promise(resolve => { release = resolve; });
  await streamAgentReply({ messages: [], voice: 'selected-voice', signal: new AbortController().signal,
    onText: value => { text = value; }, send: async e => { events.push(e); },
    timing: async stage => { timings.push(stage); if (stage === 'llm-completed') { completed = true; release(); } },
    engine: async (port, path, init) => {
      const body = JSON.parse(init.body);
      if (port === 11434) {
        assert.equal(body.stream, true); assert.equal(body.options.num_predict, -1); assert.equal(body.keep_alive, '30m');
        return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(JSON.stringify({ message: { content: 'First complete sentence.' } }) + '\n')); c.enqueue(enc.encode(JSON.stringify({ message: { content: ' Second complete sentence.' }, done: true }) + '\n')); c.close(); } }));
      }
      assert.equal(path, '/stream'); assert.equal(body.voice_id, 'selected-voice'); spoken.push(body.text);
      return new Response(new ReadableStream({ async start(c) { await waiting; assert.equal(completed, true); c.enqueue(new Uint8Array(4801).fill(16)); await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(events.some(e => e.type === 'pcm')); c.enqueue(new Uint8Array(1)); c.close(); } }), { headers: pcmHeaders });
    },
  });
  assert.deepEqual(spoken, ['First complete sentence.', 'Second complete sentence.']);
  assert.equal(text, 'First complete sentence. Second complete sentence.');
  assert.ok(timings.indexOf('tts-request-started') < timings.indexOf('llm-completed'));
  assert.ok(timings.indexOf('first-pcm-received') < timings.indexOf('sentence-synthesis-completed'));
  assert.ok(events.filter(e => e.type === 'pcm').every(e => Buffer.from(e.data, 'base64').length % 2 === 0));
});
test('interrupt cancels stale audio and prevents queued sentence requests', async () => {
  const abort = new AbortController(); const events = []; let requests = 0;
  await assert.rejects(streamAgentReply({ messages: [], voice: 'selected', signal: abort.signal, onText: () => {}, timing: async () => {},
    send: async event => { events.push(event); if (event.type === 'pcm') abort.abort(); },
    engine: async port => {
      if (port === 11434) return new Response(JSON.stringify({ message: { content: 'Sentence one. Sentence two. Sentence three.' }, done: true }) + '\n');
      requests++;
      return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(9600).fill(16)); c.close(); } }), { headers: pcmHeaders });
    },
  }), /abort/i);
  assert.equal(requests, 1); assert.equal(events.filter(e => e.type === 'pcm').length, 1);
});
test('worklet resamples PCM, clears immediately, rejects stale epochs, and drains a small final buffer', () => {
  for (const rate of [16000, 48000]) {
    let Worklet; const messages = [];
    class Processor { constructor() { this.port = { postMessage: e => messages.push(e) }; } }
    vm.runInNewContext(fs.readFileSync('public/shahvex-playback-worklet.js', 'utf8'), { AudioWorkletProcessor: Processor, Float32Array, Int16Array, sampleRate: rate, currentTime: 0, registerProcessor: (name, klass) => { Worklet = klass; } });
    const player = new Worklet(); const pcm = new Int16Array(2400).fill(16384);
    player.port.onmessage({ data: { type: 'pcm', epoch: 0, pcm: pcm.buffer } });
    const output = new Float32Array(128); player.process([], [[output]]); assert.ok(output.every(x => Math.abs(x - .5) < .001));
    player.port.onmessage({ data: { type: 'clear', epoch: 1 } });
    player.port.onmessage({ data: { type: 'pcm', epoch: 0, pcm: pcm.buffer } }); player.process([], [[output]]); assert.ok(output.every(x => x === 0));
    player.port.onmessage({ data: { type: 'pcm', epoch: 1, pcm: new Int16Array(500).fill(8192).buffer } });
    player.port.onmessage({ data: { type: 'end', epoch: 1 } }); player.process([], [[output]]); assert.ok(output.some(x => x > 0));
    for (let i = 0; i < 20; i++) player.process([], [[output]]);
    assert.ok(output.every(x => x === 0)); assert.ok(messages.some(e => e.type === 'started' && e.epoch === 1));
    assert.equal(messages.filter(e => e.type === 'started' || e.type === 'idle').at(-1).type, 'idle');
    const starts=messages.filter(e=>e.type==='started').length;
    player.port.onmessage({data:{type:'pcm',epoch:1,pcm:new Int16Array(2400).buffer}});
    for(let i=0;i<50;i++)player.process([],[[output]]);
    assert.equal(messages.filter(e=>e.type==='started').length,starts,'silent PCM must not announce speaking');
  }
});
test('empty or silent upstream PCM reports a synthesis error', async () => {
  await assert.rejects(streamAgentReply({messages:[],voice:'selected',signal:new AbortController().signal,onText:()=>{},send:async()=>{},timing:async()=>{},engine:async port=>port===11434
    ?new Response(JSON.stringify({message:{content:'A full answer.'},done:true})+'\n')
    :new Response(new Uint8Array(4800),{headers:pcmHeaders})}),/empty or silent/);
});
