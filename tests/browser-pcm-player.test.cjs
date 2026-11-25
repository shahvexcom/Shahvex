const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const vm = require('node:vm');
const code=ts.transpileModule(fs.readFileSync('lib/browser-pcm-player.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
class NodeMock {
  constructor(){this.port={postMessage(){},close(){}};}
  connect(){} disconnect(){}
}
new Function('module','exports','AudioWorkletNode',code)(mod,mod.exports,NodeMock);
const {BrowserPCMPlayer}=mod.exports;
function setup(){
  const ctx={state:'running',currentTime:0,destination:{},createGain:()=>({gain:{setValueAtTime(){}},connect(){},disconnect(){}})};
  return {ctx,player:new BrowserPCMPlayer(ctx,()=>{})};
}
test('aborting a turn releases a clear wait even when the worklet never acknowledges',{timeout:1000},async()=>{
  const {player}=setup(),control=new AbortController();
  player.clear(1);
  const pending=player.push('AAAA',1,control.signal);
  control.abort(new Error('interrupted'));
  await assert.rejects(pending,/interrupted/);
  player.dispose();
});
test('audio suspension during backpressure rejects instead of holding the conversation busy',{timeout:1000},async()=>{
  const {ctx,player}=setup();
  player.queuedMs=1100;
  const pending=player.push('AAAA',0,new AbortController().signal);
  setTimeout(()=>{ctx.state='suspended';},20);
  await assert.rejects(pending,/Audio output stopped/);
  player.dispose();
});

test('worklet buffers uneven delivery and fades across playback gaps', () => {
  let Processor;
  const events = [];
  vm.runInNewContext(fs.readFileSync('public/shahvex-playback-worklet.js', 'utf8'), {
    sampleRate: 16000,
    currentTime: 0,
    AudioWorkletProcessor: class {
      port = { postMessage: event => events.push(event) };
    },
    registerProcessor: (_, worklet) => { Processor = worklet; },
  });
  const worklet = new Processor();
  const send = (type, pcm) => worklet.port.onmessage({ data: { type, pcm, epoch: 0 } });
  function render(ms) {
    const output = new Float32Array(ms * 16);
    worklet.process([], [[output]]);
    return output;
  }
  const push = ms => send('pcm', new Int16Array(ms * 24).fill(16384).buffer);

  push(80);
  assert.ok(render(80).every(sample => sample === 0));
  push(40);
  const first = render(128);
  assert.equal(first[0], 0);
  assert.equal(first[64], 0.5);
  assert.equal(first[1919], 0);
  assert.equal(events.find(event => event.type === 'idle').underruns, 1);

  push(120);
  assert.ok(render(16).every(sample => sample === 0));
  push(80);
  assert.equal(render(8)[64], 0.5);

  send('clear');
  push(20);
  send('end');
  assert.equal(render(24)[64], 0.5);
});
