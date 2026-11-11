const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
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
